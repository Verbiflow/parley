import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { groups: true })
const { ctx, sql, base } = await testServer([fake.channel])
const sessions = ctx.sessions

async function linked(email: string) {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  fake.simulator.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }, { id: "team", name: "Team", kind: "group" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 2)
  return { accountId: account.id, connectionId }
}

test("what's new since last read: counted per chat, flagged, marked read by reading (not by listing or peeking), reactions included", async () => {
  const email = "unread@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  // Sent after the connection was made (anything sent before it is never new).
  const now = Date.now()
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  fake.simulator.deliver(connectionId, { id: "a1", threadId: "ana", from: "ana", text: "hey", at: at(1) })
  fake.simulator.deliver(connectionId, { id: "a2", threadId: "ana", from: "ana", text: "you there?", at: at(2) })
  fake.simulator.deliver(connectionId, { id: "m1", threadId: "ana", from: "me", fromMe: true, text: "yes", at: at(3) })
  fake.simulator.deliver(connectionId, { id: "g1", threadId: "team", from: "bo", text: "lunch?", at: at(1) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 4)

  const chats = async () => {
    const r = (await callTool(base, token, "list_chats")).result
    return { text: r.new_since_last_read as string, by: Object.fromEntries(r.chats.map((c: any) => [c.chat_id, c.new])) }
  }
  // The account's own message isn't new.
  assert.deepEqual(await chats(), { text: "3 new in 2 chats: 3 messages, 0 reactions. read_inbox with a chat_id to read them.", by: { ana: { messages: 2, reactions: 0 }, team: { messages: 1, reactions: 0 } } })
  assert.deepEqual((await callTool(base, token, "list_chats", { only_new: true })).result.chats.length, 2)

  // Peeking flags what's new without marking it read.
  const peek = (await callTool(base, token, "read_inbox", { chat_id: "ana", mark_read: false })).result
  assert.equal(peek.new_since_last_read.text, "2 new since last read: 2 messages, 0 reactions.")
  assert.deepEqual(peek.messages.map((m: any) => [m.id, m.new ?? false]), [["m1", false], ["a2", true], ["a1", true]])
  assert.deepEqual((await chats()).by.ana, { messages: 2, reactions: 0 })

  // Reading the chat marks it read, for this chat only.
  await callTool(base, token, "read_inbox", { chat_id: "ana" })
  assert.deepEqual((await chats()).by, { ana: { messages: 0, reactions: 0 }, team: { messages: 1, reactions: 0 } })
  const again = (await callTool(base, token, "read_inbox", { chat_id: "ana" })).result
  assert.equal(again.new_since_last_read.text, "Nothing new since last read.")
  assert.ok(again.messages.every((m: any) => !m.new))

  // A reaction to an old message is new, and listed with the message even when that message isn't on the page.
  // The account's own reaction isn't.
  const react = (from: string, emoji: string, minutes: number, fromMe = false) => ({ threadId: "ana", messageId: "a1", from, fromMe, emoji, at: at(minutes) })
  fake.simulator.react(connectionId, [react("ana", "👍", 4), react("me", "❤️", 4, true)])
  await waitUntil(chats, (c) => c.by.ana.reactions === 1)
  const page = (await callTool(base, token, "read_inbox", { chat_id: "ana", limit: 1 })).result
  assert.equal(page.new_since_last_read.text, "1 new since last read: 0 messages, 1 reaction.")
  assert.deepEqual(page.messages.map((m: any) => m.id), ["m1"])
  assert.deepEqual(page.new_reactions.map((r: any) => [r.message_id, r.message_text, r.from, r.emoji, r.on_my_message]), [["a1", "hey", "ana", "👍", false]])
  assert.deepEqual((await chats()).by.ana, { messages: 0, reactions: 0 })

  // The same reaction delivered again is old news; a changed one is new.
  fake.simulator.react(connectionId, [react("ana", "👍", 4)])
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual((await chats()).by.ana, { messages: 0, reactions: 0 })
  fake.simulator.react(connectionId, [react("ana", "🎉", 5)])
  await waitUntil(chats, (c) => c.by.ana.reactions === 1)
  const flagged = (await callTool(base, token, "read_inbox", { chat_id: "ana", mark_read: false })).result
  assert.deepEqual(flagged.messages.find((m: any) => m.id === "a1").reactions.map((r: any) => [r.from, r.emoji, r.new ?? false]), [["me", "❤️", false], ["ana", "🎉", true]])

  // History that arrives late but was sent before what's been seen isn't new; a message sent after it is.
  fake.simulator.deliver(connectionId, { id: "lost", threadId: "ana", from: "ana", text: "older", at: at(1.5) })
  fake.simulator.deliver(connectionId, { id: "a3", threadId: "ana", from: "ana", text: "newer", at: at(6) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10, chatId: "ana" }), (ms) => ms.length === 5)
  assert.deepEqual((await chats()).by.ana, { messages: 1, reactions: 1 })

  // Paging back never marks; reading across chats marks each chat it shows.
  await callTool(base, token, "read_inbox", { before: at(10) })
  assert.deepEqual((await chats()).by.ana, { messages: 1, reactions: 1 })
  const all = (await callTool(base, token, "read_inbox")).result
  assert.equal(all.new_since_last_read.text, "3 new since last read: 2 messages, 1 reaction across 2 chats.")
  assert.equal((await chats()).text, "Nothing new since last read.")
  assert.deepEqual((await callTool(base, token, "list_chats", { only_new: true })).result.chats, [])

  // Another account can't mark this one's chats.
  const { markRead } = await import("../src/sessions/chats.ts")
  const other = await store.upsertAccount(sql, { subject: "local:nosy@parley.test", email: "nosy@parley.test", name: "N", signedInWith: "local" })
  fake.simulator.deliver(connectionId, { id: "g2", threadId: "team", from: "bo", text: "?", at: at(7) })
  await waitUntil(chats, (c) => c.by.team.messages === 1)
  await markRead(sql, other.id, [{ connectionId, chatId: "team", messageSeq: 1e9 }])
  assert.deepEqual((await chats()).by.team, { messages: 1, reactions: 0 })
})

test("a chat folded into another (private id → number) keeps how far it was read", async () => {
  const email = "fold@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const now = Date.now()
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  fake.simulator.announceChats(connectionId, [{ id: "ana@lid", name: "Ana", kind: "direct" }])
  fake.simulator.deliver(connectionId, { id: "x1", threadId: "ana@lid", from: "ana", text: "hi", at: at(1) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 1)
  await callTool(base, token, "read_inbox", { chat_id: "ana@lid" })

  const { mergeChats } = await import("../src/sessions/chats.ts")
  await mergeChats(sql, connectionId, [{ from: "ana@lid", to: "ana" }])
  const ana = (await callTool(base, token, "list_chats")).result.chats.find((c: any) => c.chat_id === "ana")
  assert.deepEqual(ana.new, { messages: 0, reactions: 0 })
})

test("every other tool's answer carries a short count of what's new, without marking it read; none once all is read", async () => {
  const email = "badge@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  const news = async (tool: string, args: Record<string, unknown> = {}) => (await callTool(base, token, tool, args)).result.new_since_last_read

  assert.equal(await news("list_connections"), undefined)
  fake.simulator.deliver(connectionId, { id: "b1", threadId: "ana", from: "ana", text: "ping", at: at(1) })
  fake.simulator.deliver(connectionId, { id: "b2", threadId: "team", from: "bo", text: "pong", at: at(1) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 2)
  fake.simulator.react(connectionId, [{ threadId: "ana", messageId: "b1", from: "ana", fromMe: false, emoji: "👀", at: at(2) }])

  const badge = await waitUntil(() => news("send_availability"), (b) => b?.reactions === 1)
  assert.deepEqual({ ...badge, note: undefined }, { events: 3, messages: 2, reactions: 1, chats: 2, note: undefined })
  // Asking again changes nothing: only reading does.
  assert.equal((await news("list_connections")).events, 3)
  // A failed call is left alone.
  const failed = await callTool(base, token, "message_status", { message_id: "nope" })
  assert.equal(failed.isError, true)
  assert.equal(typeof failed.result, "string")

  await callTool(base, token, "read_inbox")
  assert.equal(await news("list_connections"), undefined)
})
