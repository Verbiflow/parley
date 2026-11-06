import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { availability, claimDue, expireLeases, getOutbound, listOutbound, resume } from "../src/sessions/outbox.ts"
import { testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa")
const { ctx, sql } = await testServer([fake.channel])
const sessions = ctx.sessions
// Tuesday 2026-11-03, 15:00 UTC: inside WhatsApp's default 08:00–21:00 window for a UTC account.
const T0 = new Date("2026-11-03T15:00:00Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

async function linked(email: string) {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  await sessions.settled()
  return { accountId: account.id, connectionId }
}

test("a message to someone new goes out now; the next opener waits its spacing; a reply doesn't", async () => {
  const { accountId, connectionId } = await linked("pace@parley.test")
  const first = await sessions.enqueue(accountId, connectionId, { to: "+15550101", text: "hi" }, T0)
  assert.equal(first.message.kind, "first_message")
  assert.equal(first.message.scheduledFor, T0.toISOString())
  await sessions.dispatchDue(T0)
  assert.deepEqual(fake.simulator.sent(connectionId).map((s) => s.to), ["+15550101"])
  assert.equal((await getOutbound(sql, accountId, first.message.id)).status, "sent")

  // Two new contacts a minute by default.
  const second = await sessions.enqueue(accountId, connectionId, { to: "+15550102", text: "hello" }, T0)
  const wait = (Date.parse(second.message.scheduledFor!) - T0.getTime()) / 1000
  assert.ok(wait >= 30, `opener spaced ${wait}s`)
  assert.ok(second.message.waits.includes("action_spacing"))
  await sessions.dispatchDue(new Date(T0.getTime() + 10_000))
  assert.equal(fake.simulator.sent(connectionId).length, 1)

  // Someone who already talked to us: a reply, not an opener, so it isn't stuck behind the spacing.
  const reply = await sessions.enqueue(accountId, connectionId, { to: "+15550101", text: "following up" }, T0)
  assert.equal(reply.message.kind, "message")
  assert.ok(Date.parse(reply.message.scheduledFor!) < Date.parse(second.message.scheduledFor!))

  await sessions.dispatchDue(new Date(Date.parse(reply.message.scheduledFor!)))
  await sessions.dispatchDue(new Date(Date.parse(second.message.scheduledFor!) + 5 * 60_000))
  assert.deepEqual(fake.simulator.sent(connectionId).map((s) => s.content.text), ["hi", "following up", "hello"])
})

test("a rate limit backs the whole connection off and re-plans its queue", async () => {
  const { accountId, connectionId } = await linked("ratelimit@parley.test")
  await sessions.enqueue(accountId, connectionId, { to: "+15550201", text: "a" }, T0)
  fake.simulator.failNextSend(connectionId, "rate_limited")
  await sessions.dispatchDue(T0)
  const [m] = await listOutbound(sql, accountId, { connectionId, limit: 5 })
  assert.equal(m!.status, "scheduled")
  assert.ok(Date.parse(m!.scheduledFor!) >= T0.getTime() + 3600_000)
  const { actions } = await availability(sql, accountId, connectionId, at(1))
  assert.equal(actions.message!.canSendNow, false)
  assert.ok(actions.message!.waits.includes("paused"))
})

test("a checkpoint halts the connection until a person resumes it", async () => {
  const { accountId, connectionId } = await linked("checkpoint@parley.test")
  await sessions.enqueue(accountId, connectionId, { to: "+15550301", text: "a" }, T0)
  fake.simulator.failNextSend(connectionId, "challenge")
  await sessions.dispatchDue(T0)
  const held = await sessions.enqueue(accountId, connectionId, { to: "+15550302", text: "b" }, at(5))
  assert.equal(held.message.held, true)
  assert.equal(held.message.scheduledFor, null)
  await sessions.dispatchDue(at(60))
  assert.equal(fake.simulator.sent(connectionId).length, 0)

  await resume(ctx.tx, accountId, connectionId, at(60))
  const [next] = await listOutbound(sql, accountId, { connectionId, status: "scheduled", limit: 5 })
  assert.ok(next!.scheduledFor)
  await sessions.dispatchDue(new Date(Date.parse(next!.scheduledFor!) + 60 * 60_000))
  assert.equal(fake.simulator.sent(connectionId).length, 1)
})

test("an unreachable recipient fails the message, not the account", async () => {
  const { accountId, connectionId } = await linked("nobody@parley.test")
  const q = await sessions.enqueue(accountId, connectionId, { to: "+15550401", text: "a" }, T0)
  fake.simulator.failNextSend(connectionId, "recipient_unavailable")
  await sessions.dispatchDue(T0)
  const m = await getOutbound(sql, accountId, q.message.id)
  assert.equal(m.status, "failed")
  assert.equal(m.error?.code, "recipient_unavailable")
  assert.equal((await availability(sql, accountId, connectionId, at(10))).actions.message!.canSendNow, true)
})

test("a send whose lease lapses fails as outcome_unknown instead of sending twice", async () => {
  const { accountId, connectionId } = await linked("lease@parley.test")
  const q = await sessions.enqueue(accountId, connectionId, { to: "+15550501", text: "a" }, T0)
  const [claimed] = await claimDue(ctx.tx, [connectionId], T0)
  assert.equal(claimed!.id, q.message.id)
  assert.equal(await expireLeases(ctx.tx, at(1)), 0)
  assert.equal(await expireLeases(ctx.tx, at(3)), 1)
  const m = await getOutbound(sql, accountId, q.message.id)
  assert.equal(m.status, "failed")
  assert.equal(m.error?.code, "outcome_unknown")
})

test("idempotency, cancel, the backlog cap, and other accounts' connections", async () => {
  const { accountId, connectionId } = await linked("misc@parley.test")
  const a = await sessions.enqueue(accountId, connectionId, { to: "+15550601", text: "a", idempotencyKey: "k1" }, T0)
  const b = await sessions.enqueue(accountId, connectionId, { to: "+15550601", text: "a", idempotencyKey: "k1" }, T0)
  assert.equal(b.replayed, true)
  assert.equal(b.message.id, a.message.id)

  const later = await sessions.enqueue(accountId, connectionId, { to: "+15550602", text: "b", notBefore: at(120) }, T0)
  assert.ok(Date.parse(later.message.scheduledFor!) >= at(120).getTime())
  const { cancel } = await import("../src/sessions/outbox.ts")
  assert.equal((await cancel(ctx.tx, accountId, later.message.id, T0)).status, "canceled")
  await assert.rejects(cancel(ctx.tx, accountId, later.message.id, T0), /only scheduled messages/)

  await sql(`insert into parley.outbound (connection_id, chat_id, kind, body, scheduled_for) select $1, 'x', 'message', 'x', now() + interval '1 year' from generate_series(1, 500)`, [connectionId])
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "+15550603", text: "c" }, T0), /already has 500 messages/)

  const other = await store.upsertAccount(sql, { subject: "local:intruder@parley.test", email: "intruder@parley.test", name: "I", signedInWith: "local" })
  await assert.rejects(sessions.enqueue(other.id, connectionId, { to: "+1", text: "x" }, T0), /not your connection/)
  await assert.rejects(getOutbound(sql, other.id, a.message.id), /no such message/)
})

test("the daily limit counts every kind together; lowering it moves the overflow to tomorrow", async () => {
  const { accountId, connectionId } = await linked("limit@parley.test")
  assert.equal((await availability(sql, accountId, connectionId, T0)).today.dailyLimit, 100)
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 2 }, T0)
  const day = (m: { scheduledFor: string | null }) => m.scheduledFor!.slice(0, 10)
  const a = await sessions.enqueue(accountId, connectionId, { to: "+15550901", text: "a" }, T0)
  const b = await sessions.enqueue(accountId, connectionId, { to: "+15550901", text: "b", kind: "message" }, T0)
  const c = await sessions.enqueue(accountId, connectionId, { to: "+15550902", text: "c" }, T0)
  assert.deepEqual([day(a.message), day(b.message)], ["2026-11-03", "2026-11-03"])
  assert.equal(day(c.message), "2026-11-04")
  assert.ok(c.message.waits.includes("daily_cap"))

  // Raising it pulls the third send back into today.
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 3 }, T0)
  assert.equal(day(await getOutbound(sql, accountId, c.message.id)), "2026-11-03")
  // Out-of-range values are ignored, not saved.
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 0 }, T0)
  assert.equal((await availability(sql, accountId, connectionId, T0)).today.dailyLimit, 3)
})

test("active hours are off unless turned on for the number; switching them replans the queue", async () => {
  const { accountId, connectionId } = await linked("hours@parley.test")
  // 3 AM in Los Angeles: outside WhatsApp's 8:00–21:00 window.
  const night = new Date("2026-11-03T11:00:00Z")
  await sessions.setLocale(accountId, connectionId, { timezone: "America/Los_Angeles" }, night)
  const m = await sessions.enqueue(accountId, connectionId, { to: "+15551001", text: "late" }, night)
  assert.equal(m.message.scheduledFor, night.toISOString())
  assert.deepEqual(m.message.waits, [])

  await sessions.setLocale(accountId, connectionId, { activeHours: true }, night)
  const held = await getOutbound(sql, accountId, m.message.id)
  assert.ok(Date.parse(held.scheduledFor!) >= Date.parse("2026-11-03T16:00:00Z"))
  // Saving other settings leaves the switch alone.
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 50 }, night)
  assert.equal((await getOutbound(sql, accountId, m.message.id)).scheduledFor, held.scheduledFor)

  await sessions.setLocale(accountId, connectionId, { activeHours: false }, night)
  assert.equal((await getOutbound(sql, accountId, m.message.id)).scheduledFor, night.toISOString())
})

test("the gap between sends is the number's to set; empty goes back to the channel's default", async () => {
  const { accountId, connectionId } = await linked("gap@parley.test")
  const gapOf = async () => {
    const a = await sessions.enqueue(accountId, connectionId, { to: "+15552001", text: "a" }, T0)
    const b = await sessions.enqueue(accountId, connectionId, { to: "+15552001", text: "b", kind: "message" }, T0)
    return (Date.parse(b.message.scheduledFor!) - Date.parse(a.message.scheduledFor!)) / 1000
  }
  const before = await gapOf()
  assert.ok(before >= 1 && before <= 3, `default gap ${before}s`)

  await sessions.setLocale(accountId, connectionId, { gapSeconds: 5 }, T0)
  // The queue is laid out again on the new gap.
  const queued = await listOutbound(sql, accountId, { connectionId, status: "scheduled", limit: 50 })
  const times = queued.map((m) => Date.parse(m.scheduledFor!)).sort((x, y) => x - y)
  assert.ok((times[1]! - times[0]!) / 1000 <= 10, "replanned onto the shorter gap")
  // Saving other settings leaves the gap alone.
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 200 }, T0)
  const last = times.at(-1)!
  const next = await sessions.enqueue(accountId, connectionId, { to: "+15552001", text: "c", kind: "message" }, T0)
  const after = (Date.parse(next.message.scheduledFor!) - last) / 1000
  assert.ok(after >= 5 && after <= 10, `custom gap ${after}s`)

  await sessions.setLocale(accountId, connectionId, { gapSeconds: null }, T0)
  const restored = await listOutbound(sql, accountId, { connectionId, status: "scheduled", limit: 50 })
  const spread = restored.map((m) => Date.parse(m.scheduledFor!)).sort((x, y) => x - y)
  for (let i = 1; i < spread.length; i++) assert.ok((spread[i]! - spread[i - 1]!) / 1000 >= 1)
})

test("messages queued behind an opener to the same person are follow-ups: a few seconds apart, and after it", async () => {
  const { accountId, connectionId } = await linked("followups@parley.test")
  const msgs = []
  for (const text of ["1", "2", "3", "4"]) msgs.push((await sessions.enqueue(accountId, connectionId, { to: "+15553001", text }, T0)).message)
  assert.deepEqual(msgs.map((m) => m.kind), ["first_message", "message", "message", "message"])
  const times = msgs.map((m) => Date.parse(m.scheduledFor!))
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i]! - times[i - 1]!) / 1000
    assert.ok(gap >= 1 && gap <= 3, `follow-up ${i} ${gap}s after the one before`)
  }

  // Held back behind its opener: when the opener waits on another contact's spacing, its follow-ups wait with it.
  const later = (await sessions.enqueue(accountId, connectionId, { to: "+15553002", text: "a" }, T0)).message
  const followUp = (await sessions.enqueue(accountId, connectionId, { to: "+15553002", text: "b" }, T0)).message
  assert.equal(followUp.kind, "message")
  assert.ok(Date.parse(followUp.scheduledFor!) > Date.parse(later.scheduledFor!))

  // Laying the queue out again keeps each chat in order.
  await sessions.setLocale(accountId, connectionId, { gapSeconds: 5 }, T0)
  const after = new Map((await listOutbound(sql, accountId, { connectionId, status: "scheduled", limit: 50 })).map((m) => [m.id, Date.parse(m.scheduledFor!)]))
  assert.ok(after.get(followUp.id)! > after.get(later.id)!)
  for (let i = 1; i < msgs.length; i++) assert.ok(after.get(msgs[i]!.id)! > after.get(msgs[i - 1]!.id)!)
})

test("new contacts per minute is the number's to set; empty goes back to the channel's default", async () => {
  const { accountId, connectionId } = await linked("openers@parley.test")
  const spacing = async () => {
    const queued = (await listOutbound(sql, accountId, { connectionId, status: "scheduled", limit: 50 })).filter((m) => m.kind === "first_message")
    const t = queued.map((m) => Date.parse(m.scheduledFor!)).sort((x, y) => x - y)
    return t.slice(1).map((x, i) => (x - t[i]!) / 1000)
  }
  for (const to of ["+15554001", "+15554002", "+15554003"]) await sessions.enqueue(accountId, connectionId, { to, text: "hi" }, T0)
  for (const s of await spacing()) assert.ok(s >= 30 && s <= 33, `default opener spacing ${s}s`)

  await sessions.setLocale(accountId, connectionId, { openersPerMinute: 1 }, T0)
  for (const s of await spacing()) assert.ok(s >= 60 && s <= 63, `one a minute ${s}s`)
  // Saving other settings leaves it alone.
  await sessions.setLocale(accountId, connectionId, { dailyLimit: 200 }, T0)
  for (const s of await spacing()) assert.ok(s >= 60 && s <= 63, `still one a minute ${s}s`)

  await sessions.setLocale(accountId, connectionId, { openersPerMinute: null }, T0)
  for (const s of await spacing()) assert.ok(s >= 30 && s <= 33, `back to default ${s}s`)
})

test("typing is per message: off unless asked, and handed to the channel with the send", async () => {
  const { accountId, connectionId } = await linked("typing@parley.test")
  const plain = await sessions.enqueue(accountId, connectionId, { to: "+15551001", text: "no typing" }, T0)
  assert.equal(plain.message.typing, false)
  await sessions.dispatchDue(T0)
  const typed = await sessions.enqueue(accountId, connectionId, { to: "+15551001", text: "with typing", typing: true }, at(1))
  assert.equal(typed.message.typing, true)
  await sessions.dispatchDue(new Date(Date.parse(typed.message.scheduledFor!) + 1000))
  const sent = fake.simulator.sent(connectionId)
  assert.deepEqual(sent.map((s) => [s.content.text, s.content.typing]), [["no typing", false], ["with typing", true]])
})

test("one account mid-send (a long typing…) doesn't hold up another's", async () => {
  const slow = await linked("slow@parley.test")
  const quick = await linked("quick@parley.test")
  await sessions.enqueue(slow.accountId, slow.connectionId, { to: "+15551101", text: "a long one" }, T0)
  const release = fake.simulator.holdNextSend(slow.connectionId)
  const first = sessions.dispatchDue(T0)
  await waitUntil(async () => (await listOutbound(sql, slow.accountId, { connectionId: slow.connectionId, limit: 1 }))[0]!.status, (s) => s === "sending")

  // The next pass claims for everyone else while the slow one is still going, and doesn't wait for it.
  await sessions.enqueue(quick.accountId, quick.connectionId, { to: "+15551102", text: "quick" }, T0)
  await sessions.dispatchDue(T0)
  assert.deepEqual(fake.simulator.sent(quick.connectionId).map((s) => s.content.text), ["quick"])
  assert.equal(fake.simulator.sent(slow.connectionId).length, 0)

  release()
  await first
  assert.deepEqual(fake.simulator.sent(slow.connectionId).map((s) => s.content.text), ["a long one"])
})
