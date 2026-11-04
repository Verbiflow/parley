import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { getOutbound } from "../src/sessions/outbox.ts"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { media: true, groups: true })
const textOnly = makeFakeChannel("fake-txt")
const { ctx, sql, base } = await testServer([fake.channel, textOnly.channel])
const sessions = ctx.sessions
const T0 = new Date("2026-11-03T15:00:00Z")

async function linked(email: string, channel = "fake-wa", sim = fake.simulator) {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, channel, { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  sim.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  sim.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }, { id: "team", name: "Team", kind: "group" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 2)
  return { accountId: account.id, connectionId }
}

const photo = { kind: "image" as const, mimetype: "image/jpeg", width: 800, height: 600, size: 1234, ref: "ref-photo-1" }

test("a photo is listed with what it is (never its fetch handle) and fetched on request", async () => {
  const { accountId, connectionId } = await linked("photo@parley.test")
  fake.simulator.deliver(connectionId, { id: "p1", threadId: "ana", from: "ana", text: "look", media: photo })
  const [m] = await waitUntil(() => sessions.inbox(accountId, { limit: 5 }), (ms) => ms.length === 1)
  assert.equal(m!.text, "look")
  assert.deepEqual(m!.media, { kind: "image", mimetype: "image/jpeg", width: 800, height: 600, size: 1234 })

  const file = await sessions.media(accountId, connectionId, "ana", "p1")
  assert.equal(Buffer.from(file.data, "base64").toString(), "ref-photo-1")
  assert.equal(file.kind, "image")

  fake.simulator.deliver(connectionId, { id: "t1", threadId: "ana", from: "ana", text: "plain" })
  await waitUntil(() => sessions.inbox(accountId, { limit: 5 }), (ms) => ms.length === 2)
  await assert.rejects(sessions.media(accountId, connectionId, "ana", "t1"), /no attachment/)
  const other = await store.upsertAccount(sql, { subject: "local:nosy@parley.test", email: "nosy@parley.test", name: "N", signedInWith: "local" })
  await assert.rejects(sessions.media(other.id, connectionId, "ana", "p1"), /not your connection/)
})

test("reactions: one per person, the latest wins, a taken-back one is gone and an older one can't revive it", async () => {
  const { accountId, connectionId } = await linked("react@parley.test")
  fake.simulator.deliver(connectionId, { id: "g1", threadId: "team", from: "bo", text: "lunch?" })
  await waitUntil(() => sessions.inbox(accountId, { limit: 5 }), (ms) => ms.length === 1)
  const r = (from: string, emoji: string, at: string, fromMe = false) => ({ threadId: "team", messageId: "g1", from, fromMe, emoji, at })
  fake.simulator.react(connectionId, [r("ana", "👍", "2026-11-03T10:00:00Z"), r("me", "😂", "2026-11-03T10:01:00Z", true), r("cy", "❤️", "2026-11-03T10:02:00Z")])
  const reactions = async () => (await sessions.inbox(accountId, { limit: 5 }))[0]!.reactions.map((x) => [x.fromMe ? "me" : x.from, x.emoji])
  await waitUntil(reactions, (rs) => rs.length === 3)
  assert.deepEqual(await reactions(), [["ana", "👍"], ["me", "😂"], ["cy", "❤️"]])

  fake.simulator.react(connectionId, [r("ana", "🎉", "2026-11-03T10:05:00Z"), r("cy", "", "2026-11-03T10:06:00Z")])
  await waitUntil(reactions, (rs) => rs.length === 2)
  // An older reaction arriving late changes nothing.
  fake.simulator.react(connectionId, [r("cy", "❤️", "2026-11-03T10:03:00Z"), r("ana", "👎", "2026-11-03T09:00:00Z")])
  // A reaction to a message Parley never stored is dropped.
  fake.simulator.react(connectionId, [{ ...r("ana", "👍", "2026-11-03T10:07:00Z"), messageId: "unknown" }])
  await new Promise((res) => setTimeout(res, 50))
  assert.deepEqual(await reactions(), [["me", "😂"], ["ana", "🎉"]])

  // Reactions that came with a history message are stored with it.
  fake.simulator.deliver(connectionId, { id: "h1", threadId: "ana", from: "ana", text: "old", reactions: [{ threadId: "ana", messageId: "h1", from: "me", fromMe: true, emoji: "🙏", at: "2026-11-01T00:00:00Z" }] })
  const h = await waitUntil(() => sessions.inbox(accountId, { limit: 5, chatId: "ana" }), (ms) => ms.length === 1)
  assert.deepEqual(h[0]!.reactions.map((x) => [x.fromMe, x.emoji]), [[true, "🙏"]])
})

test("a file and a reaction go through the paced outbox; bytes are dropped once sent", async () => {
  const { accountId, connectionId } = await linked("send-media@parley.test")
  fake.simulator.deliver(connectionId, { id: "g2", threadId: "team", from: "bo@s.whatsapp.net", text: "pics?" })
  await waitUntil(() => sessions.inbox(accountId, { limit: 5 }), (ms) => ms.length === 1)

  const data = new TextEncoder().encode("jpeg-bytes")
  const sent = await sessions.enqueue(accountId, connectionId, { to: "team", text: "here", media: { kind: "image", mimetype: "image/jpeg", data } }, T0)
  assert.deepEqual(sent.message.media, { kind: "image", mimetype: "image/jpeg" })
  await sessions.dispatchDue(T0)
  const [out] = fake.simulator.sent(connectionId)
  assert.equal(out!.content.text, "here")
  assert.equal(out!.content.media?.kind, "image")
  assert.equal(new TextDecoder().decode(out!.content.media!.data), "jpeg-bytes")
  assert.equal((await getOutbound(sql, accountId, sent.message.id)).status, "sent")
  const [row] = await sql<{ media_data: Buffer | null }>(`select media_data from parley.outbound where id = $1`, [sent.message.id])
  assert.equal(row!.media_data, null)

  const reaction = await sessions.enqueue(accountId, connectionId, { to: "team", text: "🔥", reactTo: "g2", kind: "first_message" }, T0)
  assert.equal(reaction.message.kind, "message")
  assert.equal(reaction.message.reactTo, "g2")
  await sessions.dispatchDue(new Date(Date.parse(reaction.message.scheduledFor!) + 1000))
  const last = fake.simulator.sent(connectionId).at(-1)!
  assert.deepEqual(last.content.react, { messageId: "g2", fromMe: false, sender: "bo@s.whatsapp.net" })
  assert.equal(last.content.text, "🔥")

  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "team", text: "👍", reactTo: "nope" }, T0), /no such message/)
})

test("a channel without media refuses files up front", async () => {
  const { accountId, connectionId } = await linked("txt@parley.test", "fake-txt", textOnly.simulator)
  await assert.rejects(
    sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { kind: "image", mimetype: "image/png", data: new Uint8Array([1]) } }, T0),
    /can't send files/
  )
})

test("MCP: read_inbox shows media and reactions, get_media returns a viewable image, send_message takes base64, react_to_message queues", async () => {
  const email = "mcp-media@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  fake.simulator.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 1)
  fake.simulator.deliver(connectionId, { id: "m1", threadId: "ana", from: "ana", text: "[photo]", media: { ...photo, ref: "mcp-photo" } })
  await waitUntil(() => sessions.inbox(account.id, { limit: 5 }), (ms) => ms.length === 1)
  fake.simulator.react(connectionId, [{ threadId: "ana", messageId: "m1", from: "ana", emoji: "😍", at: "2026-11-03T10:00:00Z" }])
  await waitUntil(async () => (await sessions.inbox(account.id, { limit: 5 }))[0]!.reactions, (r) => r.length === 1)

  const inbox = await callTool(base, token, "read_inbox", {})
  const [msg] = inbox.result.messages
  assert.equal(msg.media.kind, "image")
  assert.equal(msg.media.ref, undefined)
  assert.deepEqual(msg.reactions, [{ from: "ana", emoji: "😍", at: "2026-11-03T10:00:00.000Z" }])

  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_media", arguments: { connection_id: connectionId, chat_id: "ana", message_id: "m1" } } }),
  })
  const content = ((await res.json()) as { result: { content: Array<{ type: string; data?: string; mimeType?: string }> } }).result.content
  const image = content.find((c) => c.type === "image")!
  assert.equal(image.mimeType, "image/png")
  assert.equal(Buffer.from(image.data!, "base64").toString(), "mcp-photo")

  const sent = await callTool(base, token, "send_message", { connection_id: connectionId, to: "ana", media: { data: Buffer.from("png!").toString("base64"), mimetype: "image/png" } })
  assert.equal(sent.isError, false, String(sent.result))
  assert.deepEqual(sent.result.media, { kind: "image", mimetype: "image/png", file_name: null })
  assert.equal(sent.result.text, "")

  const bad = await callTool(base, token, "send_message", { connection_id: connectionId, to: "ana", media: { url: "http://169.254.169.254/latest/meta-data" } })
  assert.equal(bad.isError, true)
  assert.match(bad.result, /public internet/)
  const none = await callTool(base, token, "send_message", { connection_id: connectionId, to: "ana" })
  assert.equal(none.isError, true)

  const reacted = await callTool(base, token, "react_to_message", { connection_id: connectionId, chat_id: "ana", message_id: "m1", emoji: "👍" })
  assert.equal(reacted.isError, false, String(reacted.result))
  assert.equal(reacted.result.reaction_to, "m1")
  assert.equal(reacted.result.text, "👍")
})
