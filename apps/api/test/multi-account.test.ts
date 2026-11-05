import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa")
const { ctx, base, sql } = await testServer([fake.channel])

const WORK = "6591363557:7@s.whatsapp.net"
const HOME = "447700900111:3@s.whatsapp.net"

test("two numbers on one account: agents pick one by number, or let the chat decide", async () => {
  const email = "two-numbers@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: "Two", signedInWith: "local" })

  const link = async (handle: string) => {
    const started = await callTool(base, token, "connect", { channel: "fake-wa", country: "gb" })
    const id = started.result.connection_id as string
    await waitUntil(() => ctx.sessions.status(account.id, id), (s) => Boolean(s.link))
    fake.simulator.completeLink(id, handle)
    await waitUntil(() => ctx.sessions.status(account.id, id), (s) => s.status === "connected")
    return id
  }
  const work = await link(WORK)

  // With one account, connection_id can be left out.
  const solo = await callTool(base, token, "send_availability", {})
  assert.equal(solo.isError, false)
  assert.equal(solo.result.connection_id, work)
  assert.equal(solo.result.account, "+65 9136 3557")

  const home = await link(HOME)
  const listed = await callTool(base, token, "list_connections")
  assert.deepEqual(listed.result.connections.map((c: { account: string }) => c.account).sort(), ["+44 7700 900111", "+65 9136 3557"])
  assert.match(listed.result.note, /Several accounts/)

  // With two, an unnamed send to someone new is ambiguous, and the error names both.
  const unsure = await callTool(base, token, "send_message", { to: "+447700900999", text: "hi" })
  assert.equal(unsure.isError, true)
  assert.match(unsure.result, /\+65 9136 3557/)
  assert.match(unsure.result, /\+44 7700 900111/)

  // Naming the account by its number (written any way) picks it.
  const byNumber = await callTool(base, token, "send_message", { connection_id: "+65 9136-3557", to: "+447700900999", text: "hi" })
  assert.equal(byNumber.isError, false)
  assert.equal(byNumber.result.connection_id, work)
  assert.equal(byNumber.result.account, "+65 9136 3557")
  assert.equal((await callTool(base, token, "send_message", { connection_id: "+1 202 555 0100", to: "x", text: "hi" })).isError, true)

  // A chat that only one account has decides on its own; reads say which account each message is on.
  fake.simulator.announceChats(home, [{ id: "sam", name: "Sam", kind: "direct" }])
  await waitUntil(() => ctx.sessions.chats(account.id, home), (c) => c.length === 1)
  await ctx.sessions.chooseChats(account.id, home, ["sam"])
  fake.simulator.deliver(home, { threadId: "sam", from: "sam", text: "hey" })
  const inbox = await waitUntil(() => callTool(base, token, "read_inbox", {}), (r) => r.result.messages?.length === 1)
  assert.equal(inbox.result.messages[0].account, "+44 7700 900111")
  const reply = await callTool(base, token, "send_message", { to: "sam", text: "hello" })
  assert.equal(reply.isError, false)
  assert.equal(reply.result.connection_id, home)
  const react = await callTool(base, token, "react_to_message", { chat_id: "sam", message_id: inbox.result.messages[0].id, emoji: "👍" })
  assert.equal(react.isError, false)
  assert.equal(react.result.connection_id, home)

  // Filters take the number too.
  const homeChats = await callTool(base, token, "list_chats", { connection_id: "+447700900111" })
  assert.deepEqual(homeChats.result.chats.map((c: { chat_id: string; account: string }) => [c.chat_id, c.account]), [["sam", "+44 7700 900111"]])
  assert.equal((await callTool(base, token, "list_chats", { connection_id: "+6591363557" })).result.chats.length, 0)
})

test("linking a number that is already linked replaces the old link and keeps what it ignored and its settings", async () => {
  const email = "relinked@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: "R", signedInWith: "local" })
  const link = async (handle: string, args: Record<string, unknown> = {}) => {
    const id = (await callTool(base, token, "connect", { channel: "fake-wa", country: "sg", ...args })).result.connection_id as string
    await waitUntil(() => ctx.sessions.status(account.id, id), (s) => Boolean(s.link))
    fake.simulator.completeLink(id, handle)
    await waitUntil(() => ctx.sessions.status(account.id, id), (s) => s.status === "connected")
    return id
  }
  const first = await link("6591363557:7@s.whatsapp.net")
  await sql(`update parley.connection set ignored_chats = '["spam@g.us"]'::jsonb, daily_limit = 40, active_hours = true, gap_seconds = 90, read_receipts = false, typing = false, timezone = 'Asia/Singapore' where id = $1`, [first])
  // What it stored comes along too.
  fake.simulator.announceChats(first, [{ id: "ana", name: "Ana", kind: "direct" }])
  await waitUntil(() => ctx.sessions.chats(account.id, first), (c) => c.length === 1)
  fake.simulator.deliver(first, { id: "kept", threadId: "ana", from: "ana", text: "from the old link" })
  await waitUntil(() => ctx.sessions.inbox(account.id, { limit: 5, connectionId: first }), (m) => m.length === 1)
  const second = await link("6591363557:9@s.whatsapp.net") // same number, a new device

  const old = await waitUntil(() => ctx.sessions.list(account.id), (cs) => cs.find((c) => c.id === first)?.status === "logged_out")
  assert.equal(old.find((c) => c.id === second)?.status, "connected")
  const [row] = await sql<{ ignored_chats: string[] }>(`select ignored_chats from parley.connection where id = $1`, [second])
  assert.deepEqual(row?.ignored_chats, ["spam@g.us"])
  const kept = (await ctx.sessions.list(account.id)).find((c) => c.id === second)!
  assert.deepEqual([kept.dailyLimit, kept.activeHours, kept.gapSeconds, kept.readReceipts, kept.typing, kept.timezone], [40, true, 90, false, false, "Asia/Singapore"])
  assert.deepEqual((await ctx.sessions.inbox(account.id, { limit: 5 })).map((m) => [m.connectionId, m.text]), [[second, "from the old link"]])
  assert.equal((await callTool(base, token, "list_connections")).result.connections.length, 1)
})
