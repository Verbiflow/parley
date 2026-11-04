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

test("every other tool's answer carries what's new, split into this chat and the rest when it's about one chat; get_notifications lists it", async () => {
  const email = "badge@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  const news = async (tool: string, args: Record<string, unknown> = {}) => (await callTool(base, token, tool, args)).result.new_since_last_read

  assert.equal(await news("list_connections"), undefined)
  fake.simulator.deliver(connectionId, { id: "b1", threadId: "ana", from: "ana", text: "ping", at: at(1) })
  fake.simulator.deliver(connectionId, { id: "b2", threadId: "team", from: "bo", text: "pong", at: at(1) })
  fake.simulator.deliver(connectionId, { id: "b3", threadId: "team", from: "cy", text: "pang", at: at(2) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 3)
  fake.simulator.react(connectionId, [{ threadId: "ana", messageId: "b1", from: "ana", fromMe: false, emoji: "👀", at: at(2) }])

  // Not about a chat: the total.
  const total = await waitUntil(() => news("send_availability"), (b) => b?.all_chats?.reactions === 1)
  assert.deepEqual(total, { all_chats: { chats: 2, messages: 3, reactions: 1 } })
  // About one chat: that chat, and the rest.
  assert.deepEqual(await news("get_media", { chat_id: "ana", message_id: "b1" }), undefined) // b1 has no media: an error answer is left alone
  const sent = await news("send_message", { to: "ana", text: "hi" })
  assert.deepEqual(sent, { this_chat: { chat_id: "ana", name: "Ana", messages: 1, reactions: 1 }, other_chats: { chats: 1, messages: 2, reactions: 0 } })
  const reacted = await news("react_to_message", { chat_id: "team", message_id: "b2", emoji: "👍" })
  assert.deepEqual(reacted, { this_chat: { chat_id: "team", name: "Team", messages: 2, reactions: 0 }, other_chats: { chats: 1, messages: 1, reactions: 1 } })

  // get_notifications: the same counts and the chats with something new; never marks read, and isn't badged itself.
  const all = (await callTool(base, token, "get_notifications")).result
  const account = all.chats[0].account
  // Most recent first: Team's last message is newer.
  assert.deepEqual(all, {
    all_chats: { chats: 2, messages: 3, reactions: 1 },
    chats: [
      { channel: "fake-wa", connection_id: connectionId, account, chat_id: "team", name: "Team", kind: "group", messages: 2, reactions: 0 },
      { channel: "fake-wa", connection_id: connectionId, account, chat_id: "ana", name: "Ana", kind: "direct", messages: 1, reactions: 1 },
    ],
  })
  const inAna = (await callTool(base, token, "get_notifications", { chat_id: "ana" })).result
  assert.deepEqual(inAna.this_chat, { chat_id: "ana", name: "Ana", messages: 1, reactions: 1 })
  assert.deepEqual(inAna.other_chats, { chats: 1, messages: 2, reactions: 0 })
  assert.deepEqual(inAna.chats.map((c: any) => c.chat_id), ["team"])

  // Reading Ana clears it there only; in a chat with nothing new, this_chat says so.
  await callTool(base, token, "read_inbox", { chat_id: "ana" })
  assert.deepEqual(await news("send_message", { to: "ana", text: "again" }), { this_chat: { chat_id: "ana", name: "Ana", messages: 0, reactions: 0 }, other_chats: { chats: 1, messages: 2, reactions: 0 } })
  await callTool(base, token, "read_inbox")
  assert.equal(await news("list_connections"), undefined)
  assert.deepEqual((await callTool(base, token, "get_notifications")).result, { all_chats: { chats: 0, messages: 0, reactions: 0 }, chats: [] })
})

test("read receipts: sent by default when reading marks read, skippable per call, never once the account holder turns them off", async () => {
  const email = "receipts@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const { setAgentBehaviour } = await import("../src/sessions/settings.ts")
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  fake.simulator.deliver(connectionId, { id: "r1", threadId: "ana", from: "ana", text: "hi", at: at(1) })
  fake.simulator.deliver(connectionId, { id: "r2", threadId: "ana", from: "me", fromMe: true, text: "hey", at: at(2) })
  fake.simulator.deliver(connectionId, { id: "r3", threadId: "team", from: "bo", text: "yo", at: at(3) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 3)
  const receipts = () => fake.simulator.readReceipts(connectionId)

  // Looking, paging back, or reading with read_receipts: false tells the channel nothing.
  await callTool(base, token, "read_inbox", { mark_read: false })
  await callTool(base, token, "read_inbox", { before: at(10) })
  const skipped = (await callTool(base, token, "read_inbox", { chat_id: "team", read_receipts: false })).result
  assert.equal(skipped.read_receipts, undefined)
  assert.deepEqual(receipts(), [])

  // Reading (which marks read) sends them by default: the other side's shown messages, with the sender; not the account's own.
  const one = (await callTool(base, token, "read_inbox", { chat_id: "ana" })).result
  assert.deepEqual(one.read_receipts, { marked: 1 })
  assert.deepEqual(receipts(), [{ threadId: "ana", messageId: "r1", sender: "ana" }])
  // Asked for while only looking: sent, and Team stays new in Parley.
  const looked = (await callTool(base, token, "read_inbox", { read_receipts: true, mark_read: false })).result
  assert.deepEqual(looked.read_receipts, { marked: 2 })
  assert.deepEqual(receipts().slice(1).map((r) => r.messageId).sort(), ["r1", "r3"])
  assert.equal((await callTool(base, token, "get_notifications")).result.all_chats.messages, 0)

  // Turned off by the account holder: none by default, and an agent asking is told why.
  await setAgentBehaviour(sql, accountId, { readReceipts: false, typing: true })
  const before = receipts().length
  const quiet = (await callTool(base, token, "read_inbox", { chat_id: "ana" })).result
  assert.equal(quiet.read_receipts, undefined)
  const refused = (await callTool(base, token, "read_inbox", { chat_id: "ana", read_receipts: true })).result
  assert.equal(refused.read_receipts.marked, 0)
  assert.match(refused.read_receipts.off, /turned read receipts off/)
  assert.equal(receipts().length, before)
})

test("typing: on by default, skippable per message, never once the account holder turns it off", async () => {
  const email = "typing-setting@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const { setAgentBehaviour, agentBehaviour } = await import("../src/sessions/settings.ts")
  assert.deepEqual(await agentBehaviour(sql, accountId), { readReceipts: true, typing: true })
  const later = "2099-01-01T12:00:00Z"
  const send = (args: Record<string, unknown>) => callTool(base, token, "send_message", { connection_id: connectionId, to: "ana", text: "hi", not_before: later, ...args })
  assert.equal((await send({})).result.typing, true)
  assert.equal((await send({ typing: false })).result.typing, undefined)
  await setAgentBehaviour(sql, accountId, { readReceipts: true, typing: false })
  assert.equal((await send({})).result.typing, undefined)
  const asked = (await send({ typing: true })).result
  assert.equal(asked.typing, undefined)
  assert.match(asked.typing_note, /turned typing off/)
})
