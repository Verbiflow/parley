import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { makeWebhookPoster, type WebhookPoster } from "../src/sessions/webhook-delivery.ts"
import { checkHeaders, checkWebhookUrl, signWebhook, MAX_WEBHOOK_HEADERS, MAX_WEBHOOKS } from "../src/sessions/webhooks.ts"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { media: true, groups: true })

/** A stand-in receiver: records every request, answers with whatever `answer` says next (200 by default). */
type Received = { url: string; body: any; raw: string; headers: Record<string, string> }
const received: Received[] = []
let answers: number[] = []
const post: WebhookPoster = async ({ url, body, headers }) => {
  received.push({ url, raw: body, body: JSON.parse(body), headers })
  const status = answers.shift() ?? 200
  if (status === 0) throw new Error("connect ECONNREFUSED")
  return { status }
}

const { ctx, sql, base } = await testServer([fake.channel], { PUBLIC_URL: "https://app.parley.test" }, { postWebhook: post, webhookTimer: false })
const sessions = ctx.sessions

async function linked(email: string, handle = "6591363557@s.whatsapp.net") {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId, handle)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  fake.simulator.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }, { id: "team", name: "Team", kind: "group" }, { id: "quiet", name: "Quiet", kind: "direct" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 3)
  return { accountId: account.id, connectionId }
}

/** Let the connection's queued events land, then run the delivery loop once (after any pass already in flight). */
async function flush(now?: Date) {
  await new Promise((r) => setTimeout(r, 60))
  const first = await sessions.deliverWebhooks(now)
  return first + await sessions.deliverWebhooks(now)
}
const reset = () => { received.length = 0; answers = [] }
const pending = async (accountId: string) => (await ctx.webhooks.deliveries(sql, accountId, { limit: 100 })).filter((d) => d.status === "pending" || d.status === "sending")

function verifies(r: Received, secret: string): boolean {
  const { t, v1 } = Object.fromEntries(r.headers["parley-signature"]!.split(",").map((kv) => kv.split("="))) as { t: string; v1: string }
  return createHmac("sha256", secret).update(`${t}.${r.raw}`).digest("hex") === v1 && Math.abs(Date.now() / 1000 - Number(t)) < 300
}

test("a live message reaches the webhook, signed, with the chat and the account; the account's own sends are message.sent", async () => {
  reset()
  const { accountId, connectionId } = await linked("live@parley.test")
  const { webhook, secret } = await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/parley" })
  assert.match(secret, /^whsec_[\w-]{43}$/)
  assert.equal(webhook.secretHint, secret.slice(-4))

  fake.simulator.deliver(connectionId, { id: "m1", threadId: "ana", from: "ana", text: "hi there" })
  fake.simulator.deliver(connectionId, { id: "m2", threadId: "ana", from: "me", fromMe: true, text: "hey!" })
  await waitUntil(async () => (await sessions.inbox(accountId, { limit: 5 })).length, (n) => n === 2)
  assert.equal(await flush(), 2)

  const [r1, r2] = received.sort((a, b) => a.body.data.message.id.localeCompare(b.body.data.message.id))
  assert.equal(r1!.url, "https://hooks.example.com/parley")
  assert.equal(r1!.headers["parley-event"], "message.received")
  assert.equal(r1!.headers["parley-event-id"], r1!.body.id)
  assert.equal(r1!.headers["parley-attempt"], "1")
  assert.ok(verifies(r1!, secret), "the signature checks out with the webhook's secret")
  assert.ok(!verifies(r1!, "whsec_wrong"))
  assert.deepEqual(r1!.body.connection, { id: connectionId, channel: "fake-wa", account: "+65 9136 3557" })
  assert.deepEqual(r1!.body.data.chat, { id: "ana", name: "Ana", kind: "direct" })
  assert.deepEqual({ ...r1!.body.data.message, at: undefined }, { id: "m1", from: "ana", from_me: false, text: "hi there", at: undefined })
  assert.equal(r2!.body.type, "message.sent")
  assert.equal(r2!.body.data.message.from, "me")

  const [d] = await ctx.webhooks.deliveries(sql, accountId, { limit: 1 })
  assert.equal(d!.status, "delivered")
  assert.ok((await ctx.webhooks.get(sql, accountId, webhook.id)).lastSuccessAt)
  // The secret is sealed at rest: it's nowhere in the row.
  const [row] = await sql<Record<string, unknown>>(`select * from parley.webhook where id = $1`, [webhook.id])
  assert.ok(!JSON.stringify(row).includes(secret.slice(6)))
})

test("only real, live changes: history, repeats and ignored chats send nothing", async () => {
  reset()
  const { accountId, connectionId } = await linked("history@parley.test")
  await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/h" })
  fake.simulator.history(connectionId, [
    { id: "old1", threadId: "ana", from: "ana", text: "from last year", at: "2025-01-01T00:00:00Z" },
    { id: "old2", threadId: "ana", from: "ana", text: "and this", at: new Date().toISOString(), reactions: [{ threadId: "ana", messageId: "old2", from: "ana", emoji: "👍", at: new Date().toISOString() }] },
  ])
  await waitUntil(async () => (await sessions.inbox(accountId, { limit: 5 })).length, (n) => n === 2)
  assert.equal(await flush(), 0, "history is stored but not sent")

  fake.simulator.deliver(connectionId, { id: "n1", threadId: "ana", from: "ana", text: "new" })
  fake.simulator.deliver(connectionId, { id: "n1", threadId: "ana", from: "ana", text: "new" })
  fake.simulator.deliver(connectionId, { id: "old1", threadId: "ana", from: "ana", text: "from last year" })
  await ctx.sessions.chooseChats(accountId, connectionId, ["ana", "team"]).catch(() => {})
  await sql(`update parley.chat set synced = false where connection_id = $1 and id = 'quiet'`, [connectionId])
  fake.simulator.deliver(connectionId, { id: "q1", threadId: "quiet", from: "quiet", text: "ignored chat" })
  await flush()
  assert.deepEqual(received.map((r) => r.body.data.message.id), ["n1"])
})

test("reactions: added, changed, removed; a late older one and a removal of nothing send nothing", async () => {
  reset()
  const { accountId, connectionId } = await linked("react@parley.test")
  await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/r", events: ["reaction.added", "reaction.removed"] })
  fake.simulator.deliver(connectionId, { id: "g1", threadId: "team", from: "bo", text: "lunch?" })
  await waitUntil(async () => (await sessions.inbox(accountId, { limit: 5 })).length, (n) => n === 1)
  const r = (from: string, emoji: string, at: string, fromMe = false) => ({ threadId: "team", messageId: "g1", from, fromMe, emoji, at })
  fake.simulator.react(connectionId, [r("ana", "👍", "2026-11-03T10:00:00Z"), r("me", "😂", "2026-11-03T10:01:00Z", true)])
  await flush()
  fake.simulator.react(connectionId, [r("ana", "🎉", "2026-11-03T10:05:00Z")])
  await flush()
  fake.simulator.react(connectionId, [r("ana", "", "2026-11-03T10:06:00Z"), r("cy", "", "2026-11-03T10:06:00Z"), r("me", "👎", "2026-11-03T09:00:00Z", true)])
  await flush()
  const seen = received.map((x) => [x.body.type, x.body.data.reaction.from, x.body.data.reaction.emoji, x.body.data.reaction.previous_emoji])
  assert.deepEqual(seen.sort(), [
    ["reaction.added", "ana", "👍", null],
    ["reaction.added", "ana", "🎉", "👍"],
    ["reaction.added", "me", "😂", null],
    ["reaction.removed", "ana", "", "🎉"],
  ].sort())
  const added = received.find((x) => x.body.data.reaction.emoji === "👍")!
  assert.deepEqual(added.body.data.message, { id: "g1", from: "bo", from_me: false, text: "lunch?" })
  assert.equal(added.body.data.reaction.from_me, false)
})

test("a deletion names the message, not what it said; events a webhook didn't pick aren't sent to it", async () => {
  reset()
  const { accountId, connectionId } = await linked("delete@parley.test")
  await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/d", events: ["message.deleted"] })
  fake.simulator.deliver(connectionId, { id: "x1", threadId: "ana", from: "ana", text: "oops, secret" })
  await waitUntil(async () => (await sessions.inbox(accountId, { limit: 5 })).length, (n) => n === 1)
  fake.simulator.unsend(connectionId, [{ threadId: "ana", messageId: "x1" }, { threadId: "ana", messageId: "never-stored" }])
  await flush()
  assert.equal(received.length, 1)
  assert.equal(received[0]!.body.type, "message.deleted")
  assert.equal(received[0]!.body.data.message.id, "x1")
  assert.ok(!received[0]!.raw.includes("oops"))
})

test("media comes with what it is and an expiring download link", async () => {
  reset()
  const { accountId, connectionId } = await linked("media@parley.test")
  await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/m" })
  fake.simulator.deliver(connectionId, { id: "p1", threadId: "ana", from: "ana", text: "look", media: { kind: "image", mimetype: "image/jpeg", width: 8, height: 6, size: 12, ref: "ref-1" } })
  await waitUntil(async () => (await sessions.inbox(accountId, { limit: 5 })).length, (n) => n === 1)
  await flush()
  const media = received[0]!.body.data.message.media
  assert.equal(media.kind, "image")
  assert.equal(media.ref, undefined, "the channel's fetch handle never leaves")
  assert.match(media.download_url, /^https:\/\/app\.parley\.test\/media\//)
  assert.ok(Date.parse(media.download_expires_at) > Date.now())

  // Each delivery keeps the body it sent; a resend sends it again (same event id) with a fresh download link.
  const [d] = await ctx.webhooks.deliveries(sql, accountId, { limit: 1 })
  assert.deepEqual(d!.payload, received[0]!.body)
  const later = Date.now() + 5_000
  const realNow = Date.now
  Date.now = () => later
  let again
  try { again = await ctx.webhooks.resend(sql, accountId, d!.id) } finally { Date.now = realNow }
  assert.notEqual(again.id, d!.id)
  assert.equal(again.eventId, d!.eventId)
  await flush()
  const resent = received[1]!
  assert.equal(resent.body.id, received[0]!.body.id, "the same event id")
  assert.equal(resent.headers["parley-delivery-id"], again.id)
  assert.equal(resent.body.data.message.text, "look")
  assert.notEqual(resent.body.data.message.media.download_url, media.download_url, "a fresh link")
  assert.ok(Date.parse(resent.body.data.message.media.download_expires_at) > Date.parse(media.download_expires_at))
})

test("three attempts at most: at once, after 30 s, after 5 min; a later success delivers", async () => {
  reset()
  const { accountId, connectionId } = await linked("retry@parley.test")
  const { webhook } = await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/flaky" })
  answers = [500, 0, 503]
  fake.simulator.deliver(connectionId, { id: "f1", threadId: "ana", from: "ana", text: "one" })
  // The delivery is queued just after the message is stored, so wait for the delivery itself: each flush below is
  // meant to be exactly one attempt.
  await waitUntil(() => pending(accountId), (p) => p.length === 1)
  const t0 = new Date()
  assert.equal(await flush(t0), 1)
  let [d] = await pending(accountId)
  assert.equal(d!.attempts, 1)
  assert.equal(d!.lastError, "answered HTTP 500")
  assert.equal(Date.parse(d!.nextAttemptAt!) - t0.getTime(), 30_000)
  assert.equal(await flush(new Date(t0.getTime() + 29_000)), 0, "not before the wait")
  assert.equal(await flush(new Date(t0.getTime() + 30_000)), 1)
  ;[d] = await pending(accountId)
  assert.equal(d!.attempts, 2)
  assert.match(d!.lastError!, /ECONNREFUSED/)
  assert.equal(Date.parse(d!.nextAttemptAt!) - (t0.getTime() + 30_000), 300_000)
  assert.equal(await flush(new Date(t0.getTime() + 330_000)), 1)
  assert.deepEqual(await pending(accountId), [])
  const [failed] = await ctx.webhooks.deliveries(sql, accountId, { limit: 1 })
  assert.equal(failed!.status, "failed")
  assert.equal(failed!.attempts, 3)
  assert.equal(await flush(new Date(t0.getTime() + 3_600_000)), 0, "never a fourth")
  assert.equal(received.length, 3)
  assert.deepEqual(received.map((r) => r.headers["parley-attempt"]), ["1", "2", "3"])
  assert.equal(new Set(received.map((r) => r.body.id)).size, 1, "the same event id every attempt")
  assert.match((await ctx.webhooks.get(sql, accountId, webhook.id)).lastError!, /503/)

  reset()
  answers = [502]
  fake.simulator.deliver(connectionId, { id: "f2", threadId: "ana", from: "ana", text: "two" })
  await waitUntil(() => pending(accountId), (p) => p.length === 1)
  const t1 = new Date()
  await flush(t1)
  await flush(new Date(t1.getTime() + 30_000))
  const [ok] = await ctx.webhooks.deliveries(sql, accountId, { limit: 1 })
  assert.equal(ok!.status, "delivered")
  assert.equal(ok!.attempts, 2)
  assert.equal(ok!.lastStatus, 200)
})

test("a webhook that's off gets nothing, and turning it off drops what was waiting; a test still goes", async () => {
  reset()
  const { accountId, connectionId } = await linked("off@parley.test")
  const { webhook } = await ctx.webhooks.create(sql, accountId, { connectionId, url: "https://hooks.example.com/off" })
  fake.simulator.deliver(connectionId, { id: "o1", threadId: "ana", from: "ana", text: "queued" })
  await waitUntil(async () => (await pending(accountId)).length, (n) => n === 1)
  await ctx.webhooks.update(sql, accountId, webhook.id, { enabled: false })
  fake.simulator.deliver(connectionId, { id: "o2", threadId: "ana", from: "ana", text: "while off" })
  await flush()
  assert.equal(received.length, 0)
  const all = await ctx.webhooks.deliveries(sql, accountId, { limit: 10 })
  assert.deepEqual(all.map((d) => [d.status, d.lastError]), [["failed", "the webhook was turned off"]])

  // Real events can't be resent to a webhook that's off.
  await assert.rejects(ctx.webhooks.resend(sql, accountId, all[0]!.id), /turn it on/)

  await ctx.webhooks.test(sql, accountId, webhook.id)
  await flush()
  const t = received[0]!.body
  assert.equal(t.type, "webhook.test")
  // Shaped like a message event, so a receiver built against the test reads real ones the same way.
  assert.deepEqual(t.connection, { id: connectionId, channel: "fake-wa", account: "+65 9136 3557" })
  assert.deepEqual(t.data.chat, { id: "test", name: "Parley test", kind: "direct" })
  assert.equal(t.data.message.from_me, false)
  assert.match(t.data.message.text, /test event from Parley/)
})

test("URLs: public http(s) only, no credentials, at most ten per account; secrets rotate", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:urls@parley.test", email: "urls@parley.test", name: "U", signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  for (const bad of ["ftp://x.example.com", "https://localhost/x", "http://127.0.0.1:8080/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x",
    "https://[::1]/x", "https://[::ffff:127.0.0.1]/x", "https://db.internal/x", "https://user:pw@example.com/x", "not a url"]) {
    await assert.rejects(ctx.webhooks.create(sql, account.id, { connectionId, url: bad }), /URL|url/, bad)
  }
  assert.throws(() => checkWebhookUrl("http://example.com/x", { allowHttp: false }), /must be https/)
  assert.equal(checkWebhookUrl(" https://example.com/x#frag ", { allowHttp: false }), "https://example.com/x")
  await assert.rejects(ctx.webhooks.create(sql, account.id, { connectionId, url: "https://example.com", events: ["message.nope"] }), /unknown event/)
  await assert.rejects(ctx.webhooks.create(sql, account.id, { connectionId, url: "https://example.com", events: [] }), /at least one/)

  const made = []
  for (let i = 0; i < MAX_WEBHOOKS; i++) made.push(await ctx.webhooks.create(sql, account.id, { connectionId, url: `https://example.com/${i}` }))
  await assert.rejects(ctx.webhooks.create(sql, account.id, { connectionId, url: "https://example.com/too-many" }), /a number can have at most 10/)

  const { webhook, secret } = made[0]!
  assert.equal(await ctx.webhooks.secret(sql, account.id, webhook.id), secret)
  const rotated = await ctx.webhooks.rotateSecret(sql, account.id, webhook.id)
  assert.notEqual(rotated.secret, secret)
  assert.equal(await ctx.webhooks.secret(sql, account.id, webhook.id), rotated.secret)
  // Someone else's webhook is no one's business.
  const other = await store.upsertAccount(sql, { subject: "local:other@parley.test", email: "other@parley.test", name: "O", signedInWith: "local" })
  await assert.rejects(ctx.webhooks.secret(sql, other.id, webhook.id), /no such webhook/)
  await assert.rejects(ctx.webhooks.remove(sql, other.id, webhook.id), /no such webhook/)
  assert.equal((await ctx.webhooks.list(sql, other.id)).length, 0)
})

test("the real sender refuses private addresses (even by name) and never follows redirects", async () => {
  const hits: Array<{ req: IncomingMessage; body: string }> = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      hits.push({ req, body })
      if (req.url === "/redirect") { res.writeHead(302, { location: "http://169.254.169.254/" }); return res.end() }
      if (req.url === "/slow") return void setTimeout(() => res.end("late"), 2000)
      res.writeHead(204).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as { port: number }).port
  try {
    const guarded = makeWebhookPoster()
    const req = { body: "{}", headers: {} }
    await assert.rejects(guarded({ url: `http://127.0.0.1:${port}/x`, ...req }), /private, local or internal/)
    await assert.rejects(guarded({ url: `http://localhost:${port}/x`, ...req }), /private, local or internal/)
    await assert.rejects(guarded({ url: "http://169.254.169.254/latest/meta-data", ...req }), /private, local or internal/)
    await assert.rejects(guarded({ url: `http://[::1]:${port}/x`, ...req }), /private, local or internal/)
    assert.equal(hits.length, 0, "nothing reached the local server")

    // With the guard off (tests only), the request itself is right, and a redirect is just an answer.
    const open = makeWebhookPoster({ allowPrivate: true, timeoutMs: 500 })
    const body = JSON.stringify({ hello: "world" })
    const signature = await signWebhook("whsec_test", body, 1_700_000_000)
    assert.deepEqual(await open({ url: `http://127.0.0.1:${port}/ok`, body, headers: { Authorization: "Bearer receiver-key", "parley-signature": signature, "parley-event": "webhook.test" } }), { status: 204 })
    assert.equal(hits[0]!.req.method, "POST")
    assert.equal(hits[0]!.req.headers["content-type"], "application/json")
    assert.equal(hits[0]!.req.headers["parley-event"], "webhook.test")
    assert.equal(hits[0]!.req.headers.authorization, "Bearer receiver-key", "a webhook's own header goes over the wire")
    assert.equal(hits[0]!.body, body)
    assert.equal(signature, `t=1700000000,v1=${createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex")}`)
    assert.deepEqual(await open({ url: `http://127.0.0.1:${port}/redirect`, ...req }), { status: 302 })
    assert.equal(hits.length, 2, "the redirect wasn't followed")
    await assert.rejects(open({ url: `http://127.0.0.1:${port}/slow`, ...req }), /no answer within/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test("headers of a webhook's own: valid names, one each, none of Parley's, values on one line; blank keeps when editing", () => {
  assert.deepEqual(checkHeaders([{ name: " Authorization ", value: " Bearer k " }, { name: "", value: "" }]), [{ name: "Authorization", value: "Bearer k" }])
  for (const [h, why] of [
    [{ name: "Parley-Signature", value: "x" }, /Parley sets Parley-Signature itself/],
    [{ name: "content-type", value: "text/plain" }, /sets content-type itself/],
    [{ name: "Host", value: "evil.example" }, /sets Host itself/],
    [{ name: "Bad Name", value: "x" }, /isn't a valid header name/],
    [{ name: "X-Key", value: "a\r\nX-Injected: 1" }, /plain characters on one line/],
    [{ name: "X-Key", value: "" }, /give X-Key a value/],
  ] as const) assert.throws(() => checkHeaders([h]), why)
  assert.throws(() => checkHeaders([{ name: "X-Key", value: "a" }, { name: "x-key", value: "b" }]), /there twice/)
  assert.throws(() => checkHeaders(Array.from({ length: MAX_WEBHOOK_HEADERS + 1 }, (_, i) => ({ name: `X-${i}`, value: "v" }))), /at most 10/)
  assert.deepEqual(checkHeaders([{ name: "authorization", value: null }], { Authorization: "Bearer old" }), [{ name: "authorization", value: "Bearer old" }])
  assert.throws(() => checkHeaders([{ name: "X-New", value: null }], { Authorization: "Bearer old" }), /give X-New a value/)
})

test("a webhook can send a receiver's own key with every request: sealed at rest, sent with the signature, only ever shown as a hint", async () => {
  reset()
  const email = "routine@parley.test"
  const { accountId, connectionId: cid } = await linked(email)
  const token = await agentToken(base, email, "Grok Bot")
  const key = "Bearer routine-key-0123456789"
  const created = await callTool(base, token, "create_webhook", { url: "https://hooks.example.com/routine", headers: { Authorization: key, "X-Routine": "parley" } })
  assert.equal(created.isError, false, JSON.stringify(created.result))
  assert.deepEqual(created.result.headers, [{ name: "Authorization", value_ends_with: "6789" }, { name: "X-Routine", value_ends_with: null }])
  assert.ok(!JSON.stringify(created.result).includes("routine-key"), "the value never comes back")
  const id = created.result.id
  const [row] = await sql<Record<string, unknown>>(`select * from parley.webhook where id = $1`, [id])
  assert.ok(!JSON.stringify(row).includes("routine-key"), "sealed at rest")

  // Sent on every request, beside Parley's own headers and signature.
  await ctx.webhooks.test(sql, accountId, id)
  await flush()
  const sent = received.at(-1)!
  assert.equal(sent.headers.Authorization, key)
  assert.equal(sent.headers["X-Routine"], "parley")
  assert.ok(verifies(sent, created.result.secret), "still signed")

  // Parley's own can't be set, and a bad one changes nothing.
  for (const headers of [{ "Parley-Signature": "forged" }, { "User-Agent": "x" }, { "Bad Name": "x" }, { "X-Key": "line\r\nX-Injected: 1" }]) {
    const bad = await callTool(base, token, "update_webhook", { webhook_id: id, headers })
    assert.equal(bad.isError, true, JSON.stringify(headers))
  }
  assert.deepEqual(await ctx.webhooks.headers(sql, accountId, id), { Authorization: key, "X-Routine": "parley" })

  // On the number's page: names and hints, never the value. Editing with the value left blank keeps it; clearing a
  // name removes that header; a new row adds one.
  const cookie = (await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })).headers.get("set-cookie")!.split(";")[0]!
  const page = await (await fetch(`${base}/app/connections/${cid}`, { headers: { cookie } })).text()
  assert.match(page, /sends <span class="hdl">Authorization<\/span> …6789, <span class="hdl">X-Routine<\/span>/)
  assert.match(page, /value="Authorization" placeholder=""[^>]*>\s*<input[^>]*placeholder="unchanged \(…6789\)"/)
  assert.ok(!page.includes("routine-key"))
  const edit = await fetch(`${base}/app/connections/${cid}/webhooks/${id}/update`, {
    method: "POST", redirect: "manual", headers: { cookie },
    body: new URLSearchParams([["url", "https://hooks.example.com/routine"], ["events", "message.received"],
      ["header_name", "Authorization"], ["header_value", ""], ["header_name", ""], ["header_value", ""], ["header_name", "X-Two"], ["header_value", "two"]]),
  })
  assert.equal(edit.status, 302)
  assert.deepEqual(await ctx.webhooks.headers(sql, accountId, id), { Authorization: key, "X-Two": "two" })

  // An agent can replace them all, or remove them with {}.
  assert.equal((await callTool(base, token, "update_webhook", { webhook_id: id, headers: {} })).isError, false)
  assert.deepEqual(await ctx.webhooks.headers(sql, accountId, id), {})
  reset()
  await ctx.webhooks.test(sql, accountId, id)
  await flush()
  assert.equal(received.at(-1)!.headers.Authorization, undefined)
})

test("agents manage webhooks over MCP, and each number's page shows and configures them", async () => {
  reset()
  const email = "mcp-hooks@parley.test"
  const { accountId: owner, connectionId: cid } = await linked(email)
  const token = await agentToken(base, email, "Hook Agent")
  const created = await callTool(base, token, "create_webhook", { url: "https://hooks.example.com/agent", events: ["message.received"], description: "CRM sync" })
  assert.equal(created.isError, false, JSON.stringify(created.result))
  assert.match(created.result.secret, /^whsec_/)
  assert.match(created.result.verify, /Parley-Signature/)
  assert.equal(created.result.created_by, "agent: Hook Agent")
  assert.equal(created.result.connection_id, cid, "with one number, it's that one")
  assert.equal(created.result.account, "+65 9136 3557")
  const id = created.result.id

  const bad = await callTool(base, token, "create_webhook", { url: "http://10.1.2.3/x" })
  assert.equal(bad.isError, true)
  assert.match(String(bad.result), /public internet/)

  // test_webhook waits for the first attempt; here the delivery loop runs by hand alongside it.
  const tested = callTool(base, token, "test_webhook", { webhook_id: id })
  const loop = setInterval(() => void sessions.deliverWebhooks(), 100)
  const result = await tested.finally(() => clearInterval(loop))
  assert.equal(result.result.status, "delivered", JSON.stringify(result.result))
  assert.match(result.result.note, /HTTP 200/)

  const listed = await callTool(base, token, "list_webhooks")
  assert.equal(listed.result.webhooks.length, 1)
  assert.equal(listed.result.webhooks[0].secret, undefined, "listing never shows the secret")
  assert.equal(listed.result.webhooks[0].account, "+65 9136 3557")
  assert.equal(listed.result.webhooks[0].recent_deliveries[0].event, "webhook.test")
  assert.equal(listed.result.webhooks[0].recent_deliveries[0].payload, undefined, "payloads only when asked")
  assert.equal(listed.result.payload_format.read_text_at, "data.message.text (not data.text)")
  assert.ok(created.result.payload_format.example.data.message.text, "create_webhook says what the body looks like")
  assert.match(result.result.payload.data.message.text, /test event from Parley/, "test_webhook shows what it sent")
  const withBodies = await callTool(base, token, "list_webhooks", { include_payloads: true })
  const sent = withBodies.result.webhooks[0].recent_deliveries[0]
  assert.equal(sent.payload.id, sent.event_id)
  const again = callTool(base, token, "resend_webhook_delivery", { delivery_id: sent.id })
  const loop2 = setInterval(() => void sessions.deliverWebhooks(), 100)
  const resent = await again.finally(() => clearInterval(loop2))
  assert.equal(resent.isError, false, JSON.stringify(resent.result))
  assert.equal(resent.result.status, "delivered")
  assert.equal(resent.result.event_id, sent.event_id)
  assert.equal(resent.result.resent_from, sent.id)

  const updated = await callTool(base, token, "update_webhook", { webhook_id: id, enabled: false, rotate_secret: true })
  assert.equal(updated.result.enabled, false)
  assert.notEqual(updated.result.secret, created.result.secret)

  // The account holder sees it on that number's page, with who made it.
  const cookie = (await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })).headers.get("set-cookie")!.split(";")[0]!
  const pageOf = async () => (await fetch(`${base}/app/connections/${cid}`, { headers: { cookie } })).text()
  const page = await pageOf()
  assert.match(page, /id="webhooks"/)
  assert.match(page, /hooks\.example\.com\/agent/)
  assert.match(page, /agent: Hook Agent/)
  assert.match(page, /CRM sync/)
  assert.match(page, /webhook\.test/)
  assert.ok(!page.includes(updated.result.secret), "the secret isn't on the page unless asked for")
  // The old top-level page sends people to the overview.
  assert.equal((await fetch(`${base}/app/webhooks`, { headers: { cookie }, redirect: "manual" })).headers.get("location"), "/app")

  // Adding one from the page shows its secret right there, once.
  const at = `${base}/app/connections/${cid}/webhooks`
  const add = await fetch(at, { method: "POST", headers: { cookie }, body: new URLSearchParams([["url", "https://hooks.example.com/dash"], ["events", "message.received"], ["events", "reaction.added"]]) })
  assert.equal(add.status, 200)
  const added = await add.text()
  const secret = added.match(/whsec_[\w-]{43}/)?.[0]
  assert.ok(secret, "the new secret is shown")
  const mine = (await callTool(base, token, "list_webhooks")).result.webhooks.find((w: { url: string }) => w.url === "https://hooks.example.com/dash")
  assert.deepEqual(mine.events, ["message.received", "reaction.added"])
  assert.equal(mine.created_by, "dashboard")
  assert.equal(mine.connection_id, cid)
  const reveal = await (await fetch(`${at}/${mine.id}/secret`, { method: "POST", headers: { cookie } })).text()
  assert.ok(reveal.includes(secret!))

  // Everything else is configurable from the page too: edit, off/on, test, rotate.
  const form = (action: string, body?: URLSearchParams) => fetch(`${at}/${mine.id}/${action}`, { method: "POST", headers: { cookie }, body, redirect: "manual" })
  const hook = async () => (await callTool(base, token, "list_webhooks")).result.webhooks.find((w: { id: string }) => w.id === mine.id)
  const edited = await form("update", new URLSearchParams([["url", "https://hooks.example.com/dash2"], ["description", "Edited"], ["events", "message.deleted"]]))
  assert.equal(edited.status, 302)
  assert.equal(edited.headers.get("location"), `/app/connections/${cid}?webhook=saved#webhooks`)
  assert.deepEqual([(await hook()).url, (await hook()).description, (await hook()).events], ["https://hooks.example.com/dash2", "Edited", ["message.deleted"]])
  const badEdit = await form("update", new URLSearchParams([["url", "https://10.0.0.1/x"], ["events", "message.deleted"]]))
  assert.equal(badEdit.status, 400)
  assert.equal((await hook()).url, "https://hooks.example.com/dash2", "a refused edit changes nothing")
  await form("disable")
  assert.equal((await hook()).enabled, false)
  assert.match(await pageOf(), /Turn on/)
  await form("enable")
  assert.equal((await hook()).enabled, true)
  reset()
  assert.equal((await form("test")).headers.get("location"), `/app/connections/${cid}?webhook=tested#webhooks`)
  await flush()
  assert.equal(received.at(-1)!.url, "https://hooks.example.com/dash2")
  assert.ok(verifies(received.at(-1)!, secret!))
  const rotatedPage = await (await form("rotate")).text()
  const newSecret = rotatedPage.match(/whsec_[\w-]{43}/)?.[0]
  assert.ok(newSecret && newSecret !== secret)
  await form("test")
  await flush()
  assert.ok(verifies(received.at(-1)!, newSecret!), "signed with the rotated secret")

  // Each delivery's payload is on the page, and it can be resent from there.
  const [last] = await ctx.webhooks.deliveries(sql, owner, { connectionId: cid, limit: 1 })
  const withPayload = await pageOf()
  assert.match(withPayload, new RegExp(`id="pl-${last!.id}" hidden`))
  assert.ok(withPayload.includes(`/webhooks/deliveries/${last!.id}/resend`))
  assert.ok(withPayload.includes("test event from Parley"), "the payload is shown")
  const before = received.length
  const resend = await fetch(`${at}/deliveries/${last!.id}/resend`, { method: "POST", headers: { cookie }, redirect: "manual" })
  assert.equal(resend.headers.get("location"), `/app/connections/${cid}?webhook=resent#webhooks`)
  await flush()
  assert.equal(received.length, before + 1)
  assert.equal(received.at(-1)!.body.id, last!.eventId)
  assert.equal((await fetch(`${base}/app/connections/${cid}/webhooks/deliveries/${crypto.randomUUID()}/resend`, { method: "POST", headers: { cookie }, redirect: "manual" })).status, 404)
  assert.ok(!verifies(received.at(-1)!, secret!))

  const rejected = await fetch(at, { method: "POST", headers: { cookie }, body: new URLSearchParams({ url: "https://localhost/x" }) })
  assert.equal(rejected.status, 400)
  assert.match(await rejected.text(), /public internet/)

  // Someone else's number or webhook: not found.
  const other = await linked("nosy-hooks@parley.test", "447700900222@s.whatsapp.net")
  assert.equal((await fetch(`${base}/app/connections/${other.connectionId}/webhooks`, { method: "POST", headers: { cookie }, body: new URLSearchParams({ url: "https://example.com/x" }) })).status, 404)
  assert.equal((await fetch(`${base}/app/connections/${other.connectionId}/webhooks/${mine.id}/delete`, { method: "POST", headers: { cookie }, redirect: "manual" })).status, 404)

  await form("delete")
  const deleted = await callTool(base, token, "delete_webhook", { webhook_id: id })
  assert.equal(deleted.isError, false)
  assert.equal((await callTool(base, token, "list_webhooks")).result.webhooks.length, 0)
})

test("each number has its own webhooks: the overview says which have them, and a relink keeps them", async () => {
  reset()
  const email = "two-numbers@parley.test"
  const a = await linked(email, "6591110000@s.whatsapp.net")
  const b = await linked(email, "6592220000@s.whatsapp.net")
  const token = await agentToken(base, email, "Hook Agent")
  // With two numbers an agent has to say which.
  const which = await callTool(base, token, "create_webhook", { url: "https://hooks.example.com/which" })
  assert.equal(which.isError, true)
  const onA = await callTool(base, token, "create_webhook", { connection_id: "+65 9111 0000", url: "https://hooks.example.com/a" })
  assert.equal(onA.result.connection_id, a.connectionId)

  fake.simulator.deliver(b.connectionId, { id: "b1", threadId: "ana", from: "ana", text: "to B" })
  fake.simulator.deliver(a.connectionId, { id: "a1", threadId: "ana", from: "ana", text: "to A" })
  await waitUntil(async () => (await sessions.inbox(a.accountId, { limit: 5 })).length, (n) => n === 2)
  await flush()
  assert.deepEqual(received.map((r) => [r.url, r.body.data.message.id]), [["https://hooks.example.com/a", "a1"]], "B's message doesn't reach A's webhook")

  const cookie = (await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })).headers.get("set-cookie")!.split(";")[0]!
  const overview = await (await fetch(`${base}/app`, { headers: { cookie } })).text()
  const card = (cid: string) => overview.match(new RegExp(`href="/app/connections/${cid}#webhooks">([\\s\\S]*?)</a>`))?.[1] ?? ""
  assert.match(card(a.connectionId), /Webhooks<\/span><span class="m">1</)
  assert.match(card(b.connectionId), /Configure/)
  assert.match(await (await fetch(`${base}/app/connections/${b.connectionId}`, { headers: { cookie } })).text(), /Configure a webhook/)

  // Linking number A again replaces its old connection; the webhook comes along.
  reset()
  const again = await linked(email, "6591110000@s.whatsapp.net")
  await waitUntil(async () => (await ctx.webhooks.list(sql, a.accountId, { connectionId: again.connectionId })).length, (n) => n === 1)
  fake.simulator.deliver(again.connectionId, { id: "a2", threadId: "ana", from: "ana", text: "after relink" })
  await waitUntil(async () => (await pending(a.accountId)).length, (n) => n === 1)
  await flush()
  assert.deepEqual(received.map((r) => [r.url, r.body.connection.id]), [["https://hooks.example.com/a", again.connectionId]])
})
