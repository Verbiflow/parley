import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa")
const { ctx, base, sql } = await testServer([fake.channel])

test("agents queue sends over MCP, see when they go out, and find chats waiting on them", async () => {
  const email = "agent-send@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: "A", signedInWith: "local" })

  const started = await callTool(base, token, "connect", { channel: "fake-wa", timezone: "Europe/London", country: "gb" })
  const connectionId = started.result.connection_id as string
  await waitUntil(() => ctx.sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => ctx.sessions.status(account.id, connectionId), (s) => s.status === "connected")
  const [conn] = (await callTool(base, token, "list_connections")).result.connections
  assert.deepEqual([conn.timezone, conn.country], ["Europe/London", "GB"])

  const sent = await callTool(base, token, "send_message", { connection_id: connectionId, to: "+447700900123", text: "Hello!", idempotency_key: "first" })
  assert.equal(sent.isError, false)
  assert.equal(sent.result.status, "scheduled")
  assert.equal(sent.result.kind, "first_message")
  assert.ok(sent.result.scheduled_for)
  assert.match(sent.result.note, /^Queued/)
  const again = await callTool(base, token, "send_message", { connection_id: connectionId, to: "+447700900123", text: "Hello!", idempotency_key: "first" })
  assert.equal(again.result.id, sent.result.id)
  assert.equal(again.result.replayed, true)

  const avail = await callTool(base, token, "send_availability", { connection_id: connectionId })
  assert.equal(avail.result.timezone, "Europe/London")
  assert.ok("first_message" in avail.result.actions)
  assert.equal(avail.result.daily_limit, 100)

  const second = await callTool(base, token, "send_message", { connection_id: connectionId, to: "+447700900456", text: "Later", not_before: "2099-01-01T12:00:00Z" })
  // Typing is on by default (the account holder's setting); an agent can skip it.
  assert.equal(second.result.typing, true)
  const plain = await callTool(base, token, "send_message", { connection_id: connectionId, to: "+447700900790", text: "plain", typing: false, not_before: "2099-01-01T12:00:00Z" })
  assert.equal(plain.result.typing, undefined)
  await callTool(base, token, "cancel_message", { message_id: plain.result.id })
  const typed = await callTool(base, token, "send_message", { connection_id: connectionId, to: "+447700900789", text: "typed", typing: true, not_before: "2099-01-01T12:00:00Z" })
  assert.equal(typed.result.typing, true)
  await callTool(base, token, "cancel_message", { message_id: typed.result.id })
  const queued = (await callTool(base, token, "list_outbox", { status: "scheduled" })).result.messages
  assert.deepEqual(queued.map((m: { id: string }) => m.id).sort(), [sent.result.id, second.result.id].sort())
  assert.match(second.result.next, /message_status/)
  const waiting2 = await callTool(base, token, "message_status", { message_id: second.result.id })
  assert.equal(waiting2.isError, false)
  assert.equal(waiting2.result.status, "scheduled")
  assert.equal(waiting2.result.scheduled_for, "2099-01-01T12:00:00.000Z")
  assert.match(waiting2.result.note, /waiting its turn/)
  const canceled = await callTool(base, token, "cancel_message", { message_id: second.result.id })
  assert.equal(canceled.result.status, "canceled")
  assert.equal((await callTool(base, token, "message_status", { message_id: second.result.id })).result.status, "canceled")
  assert.equal((await callTool(base, token, "message_status", { message_id: "nope" })).isError, true)
  const otherToken = await agentToken(base, "agent-nosy@parley.test", "Nosy")
  const nosy = await callTool(base, otherToken, "message_status", { message_id: sent.result.id })
  assert.equal(nosy.isError, true)

  // A synced chat whose last word was theirs is waiting on the agent.
  fake.simulator.announceChats(connectionId, [{ id: "sam", name: "Sam", kind: "direct" }, { id: "kim", name: "Kim", kind: "direct" }])
  await waitUntil(() => ctx.sessions.chats(account.id, connectionId), (c) => c.length === 2)
  await ctx.sessions.chooseChats(account.id, connectionId, ["sam", "kim"])
  fake.simulator.deliver(connectionId, { threadId: "sam", from: "sam", text: "you there?" })
  fake.simulator.deliver(connectionId, { threadId: "kim", from: "me", text: "ping", fromMe: true })
  await waitUntil(() => ctx.sessions.inbox(account.id, { limit: 10 }), (m) => m.length === 2)
  const waiting = (await callTool(base, token, "list_chats", { awaiting_reply: true })).result.chats
  assert.deepEqual(waiting.map((c: { chat_id: string; awaiting: string }) => [c.chat_id, c.awaiting]), [["sam", "you"]])
})

test("an agent over its request budget gets 429 with Retry-After", async () => {
  const limited = await testServer([fake.channel], {}, { limiter: { hit: async (key) => (key.startsWith("mcp:") ? 17 : 0), close: async () => {} } })
  const token = await agentToken(limited.base, "busy@parley.test", "Busy")
  const res = await callTool(limited.base, token, "list_channels")
  assert.equal(res.status, 429)
  assert.equal(res.headers.get("retry-after"), "17")
  assert.equal(res.result.error, "rate_limited")
})
