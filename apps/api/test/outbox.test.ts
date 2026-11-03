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

  const second = await sessions.enqueue(accountId, connectionId, { to: "+15550102", text: "hello" }, at(1))
  const wait = (Date.parse(second.message.scheduledFor!) - T0.getTime()) / 60_000
  assert.ok(wait >= 10, `opener spaced ${wait} min`)
  assert.ok(second.message.waits.includes("action_spacing"))
  await sessions.dispatchDue(at(2))
  assert.equal(fake.simulator.sent(connectionId).length, 1)

  // Someone who already talked to us: a reply, not an opener, so it isn't stuck behind the spacing.
  const reply = await sessions.enqueue(accountId, connectionId, { to: "+15550101", text: "following up" }, at(3))
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
