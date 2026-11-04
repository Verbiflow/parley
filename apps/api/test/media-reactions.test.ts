import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { getOutbound } from "../src/sessions/outbox.ts"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { media: true, groups: true })
const textOnly = makeFakeChannel("fake-txt")
// Sending from a URL downloads on the sessions service; here a stand-in serves a few known files.
const served: Record<string, { body: string; type?: string }> = {
  "https://cdn.example.com/clip.mp4": { body: "mp4-bytes", type: "video/mp4" },
  "https://cdn.example.com/files/report": { body: "%PDF-1.7", type: "application/pdf" },
}
const fetchMedia = async (url: string) => {
  const f = served[url]
  if (!f) throw new (await import("../src/mcp/media.ts")).MediaInputError("couldn't download the file (HTTP 404)")
  return { data: new TextEncoder().encode(f.body), contentType: f.type, fileName: url.split("/").pop() }
}
const { ctx, sql, base } = await testServer([fake.channel, textOnly.channel], {}, { fetchMedia })
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
  assert.equal(image.mimeType, "image/jpeg")
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

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
  return ((await res.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string; resource?: { blob: string; mimeType: string } }> } }).result
}

test("files of every kind: videos give their preview and a download link, text files read inline, PDFs as documents, and links stream the real file", async () => {
  const email = "files@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  fake.simulator.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 1)
  const thumb = Buffer.from("tiny-jpeg").toString("base64")
  const deliver = (id: string, media: Record<string, unknown>) => fake.simulator.deliver(connectionId, { id, threadId: "ana", from: "ana", text: `[${media.kind}]`, media: media as never })
  deliver("vid", { kind: "video", mimetype: "video/mp4", size: 80 * 1024 * 1024, seconds: 42, ref: "the-video", thumbnail: thumb })
  deliver("csv", { kind: "document", mimetype: "text/csv", fileName: "people.csv", size: 20, ref: "name,age\nana,30" })
  deliver("pdf", { kind: "document", mimetype: "application/pdf", fileName: "deck.pdf", size: 9, ref: "%PDF-deck" })
  deliver("zip", { kind: "document", mimetype: "application/zip", fileName: "a.zip", size: 3, ref: "zip" })
  await waitUntil(() => sessions.inbox(account.id, { limit: 10 }), (m) => m.length === 4)

  // read_inbox stays lean: no preview bytes in the listing.
  const listed = (await callTool(base, token, "read_inbox", {})).result.messages
  assert.ok(listed.every((m: { media: Record<string, unknown> }) => !("thumbnail" in m.media) && !("ref" in m.media)))

  const video = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "vid" })
  const about = JSON.parse(video.content[0]!.text!)
  assert.equal(about.seconds, 42)
  assert.match(about.download_url, /\/media\//)
  assert.deepEqual(video.content.slice(1).map((c) => [c.type, c.data]), [["image", thumb]])

  const csv = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "csv" })
  assert.equal(csv.content[1]!.text, "name,age\nana,30")
  const pdf = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "pdf" })
  assert.equal(pdf.content[1]!.type, "resource")
  assert.equal(Buffer.from(pdf.content[1]!.resource!.blob, "base64").toString(), "%PDF-deck")
  const zip = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "zip" })
  assert.equal(zip.content.length, 1)

  // The link: the whole file, as a download that can't render as a page here; anything else is refused.
  const res = await fetch(about.download_url)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "the-video")
  assert.equal(res.headers.get("content-type"), "video/mp4")
  assert.match(res.headers.get("content-disposition")!, /^attachment; filename="video-vid\.mp4"/)
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  assert.match(res.headers.get("content-security-policy")!, /sandbox/)
  assert.equal((await fetch(`${about.download_url}x`)).status, 404)
  assert.equal((await fetch(`${base}/media/not-a-token`)).status, 404)
})

test("sending from a URL: the sessions service downloads it (videos past 16 MB allowed), and a bad link fails the call", async () => {
  const { accountId, connectionId } = await linked("url-send@parley.test")
  const v = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "watch", media: { url: "https://cdn.example.com/clip.mp4" } }, T0)
  assert.deepEqual(v.message.media, { kind: "video", mimetype: "video/mp4", fileName: "clip.mp4" })
  const d = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { url: "https://cdn.example.com/files/report", fileName: "Q3.pdf" } }, T0)
  assert.deepEqual(d.message.media, { kind: "document", mimetype: "application/pdf", fileName: "Q3.pdf" })
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { url: "https://cdn.example.com/missing.mp4" } }, T0), /HTTP 404/)
  await assert.rejects(
    sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { kind: "image", mimetype: "image/jpeg", data: new Uint8Array(17 * 1024 * 1024) } }, T0),
    /image can be at most 16 MB/
  )
  await sessions.dispatchDue(T0)
  const [out] = fake.simulator.sent(connectionId)
  assert.equal(out!.content.media?.kind, "video")
  assert.equal(new TextDecoder().decode(out!.content.media!.data), "mp4-bytes")
})

test("backfill: asks for each recent chat's history before its newest message, and a message seen again gets its media and reactions filled in", async () => {
  const { accountId, connectionId } = await linked("backfill@parley.test")
  const at = (m: number) => new Date(Date.parse("2026-11-04T01:00:00Z") + m * 60_000).toISOString()
  // Stored by older code: a photo with no media info, then two more messages.
  fake.simulator.deliver(connectionId, { id: "old", threadId: "ana", from: "ana", text: "[photo]", at: at(-600) })
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0) })
  fake.simulator.deliver(connectionId, { id: "t", threadId: "ana", from: "me", fromMe: true, text: "nice", at: at(5) })
  fake.simulator.deliver(connectionId, { id: "g", threadId: "team", from: "bo@s.whatsapp.net", text: "hi", at: at(2) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (m) => m.length === 4)

  const plan = await sessions.backfill(accountId, connectionId, at(-60))
  assert.deepEqual(plan, { chats: 2, messages: 3 })
  await waitUntil(async () => fake.simulator.backfills(connectionId), (b) => b.length === 2, 10_000)
  const asked = Object.fromEntries(fake.simulator.backfills(connectionId).map((b) => [b.anchor.threadId, [b.anchor.messageId, b.anchor.fromMe, b.count]]))
  assert.deepEqual(asked, { ana: ["t", true, 2], team: ["g", false, 1] })

  // The phone's answer: the same message, now with its attachment and a reaction.
  const reaction = { threadId: "ana", messageId: "p", from: "me", fromMe: true, emoji: "❤️", at: at(1) }
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0), media: { ...photo, ref: "late", thumbnail: "dGh1bWI=" }, reactions: [reaction] })
  const filled = await waitUntil(() => sessions.inbox(accountId, { limit: 10, chatId: "ana" }), (m) => m.some((x) => x.id === "p" && x.media))
  const p = filled.find((x) => x.id === "p")!
  assert.equal(p.media?.kind, "image")
  assert.deepEqual(p.reactions.map((r) => r.emoji), ["❤️"])
  assert.equal(filled.filter((x) => x.id === "p").length, 1)
  assert.equal((await sessions.mediaInfo(accountId, connectionId, "ana", "p")).thumbnail, "dGh1bWI=")
  // Seen once more without a preview: what's stored stays.
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0), media: { ...photo, ref: "later" } })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal((await sessions.mediaInfo(accountId, connectionId, "ana", "p")).thumbnail, "dGh1bWI=")
})
