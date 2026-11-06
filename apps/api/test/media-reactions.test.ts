import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { setIgnored } from "../src/sessions/chats.ts"
import { getOutbound } from "../src/sessions/outbox.ts"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { media: true, groups: true })
const textOnly = makeFakeChannel("fake-txt", { unsend: false })
// Sending from a URL downloads on the sessions service; here a stand-in serves a few known files.
const served: Record<string, { body: string | Uint8Array; type?: string }> = {
  "https://cdn.example.com/clip.mp4": { body: "mp4-bytes", type: "video/mp4" },
  "https://cdn.example.com/files/report": { body: "%PDF-1.7", type: "application/pdf" },
  "https://media.example.com/dance.mp4": { body: "mp4-bytes", type: "video/mp4" },
}
// A real two-frame 5x3 GIF (odd sizes, which H.264 can't take as they are).
const GIF = Buffer.from("R0lGODlhBQADAPcfMQAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGy0AJC0ALS0ANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpD8qrT8qtj8qvz8qgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2y0/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAfACwAAAAABQADAAAICAAPCBxIsGBAACH5BAUUAAAALAQAAgABAAEAAAgEAAEEBAAh+QQFFAAAACwEAAIAAQABAAAIBAABBAQAIfkEBRQAAAAsAAAAAAUAAwAACAgAgQkcSLBgQAA7", "base64")
served["https://media.example.com/dance.gif"] = { body: new Uint8Array(GIF), type: "image/gif" }
const isMp4 = (b: Uint8Array) => Buffer.from(b.subarray(4, 8)).toString() === "ftyp"
const fetchMedia = async (url: string) => {
  const f = served[url]
  if (!f) throw new (await import("../src/mcp/media.ts")).MediaInputError("couldn't download the file (HTTP 404)")
  return { data: typeof f.body === "string" ? new TextEncoder().encode(f.body) : f.body, contentType: f.type, fileName: url.split("/").pop() }
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
  await sessions.settled()
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
  // The message is stored a moment before its reactions: wait for both.
  const h = await waitUntil(() => sessions.inbox(accountId, { limit: 5, chatId: "ana" }), (ms) => ms.length === 1 && ms[0]!.reactions.length === 1)
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
  await sessions.settled()
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
  await sessions.settled()
  fake.simulator.announceChats(connectionId, [{ id: "ana", name: "Ana", kind: "direct" }])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 1)
  const thumb = Buffer.from("tiny-jpeg").toString("base64")
  const deliver = (id: string, media: Record<string, unknown>) => fake.simulator.deliver(connectionId, { id, threadId: "ana", from: "ana", text: `[${media.kind}]`, media: media as never })
  deliver("vid", { kind: "video", mimetype: "video/mp4", size: 80 * 1024 * 1024, seconds: 42, ref: "the-video", thumbnail: thumb })
  deliver("csv", { kind: "document", mimetype: "text/csv", fileName: "people.csv", size: 20, ref: "name,age\nana,30" })
  deliver("pdf", { kind: "document", mimetype: "application/pdf", fileName: "deck.pdf", size: 9, ref: "%PDF-deck" })
  deliver("zip", { kind: "document", mimetype: "application/zip", fileName: "a.zip", size: 3, ref: "zip" })
  deliver("vn", { kind: "audio", mimetype: "audio/ogg; codecs=opus", size: 11, seconds: 5, ref: "OggS-voice" })
  await waitUntil(() => sessions.inbox(account.id, { limit: 10 }), (m) => m.length === 5)

  // read_inbox stays lean: no preview bytes in the listing.
  const listed = (await callTool(base, token, "read_inbox", {})).result.messages
  assert.ok(listed.every((m: { media: Record<string, unknown> }) => !("thumbnail" in m.media) && !("ref" in m.media)))

  const video = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "vid" })
  const about = JSON.parse(video.content[0]!.text!)
  assert.equal(about.seconds, 42)
  assert.match(about.download_url, /\/media\//)
  // Too big to attach (80 MB): the preview, and the link to save it from.
  assert.deepEqual(video.content.slice(1).map((c) => [c.type, c.data]), [["image", thumb]])
  assert.match(about.note, /Too big to attach/)

  const csv = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "csv" })
  assert.equal(csv.content[1]!.text, "name,age\nana,30")
  const pdf = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "pdf" })
  assert.equal(pdf.content[1]!.type, "resource")
  assert.equal(Buffer.from(pdf.content[1]!.resource!.blob, "base64").toString(), "%PDF-deck")
  const zip = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "zip" })
  assert.equal(zip.content[1]!.type, "resource")

  // A voice note comes back as the file itself (named, so a client saves it as such), plus a ready save command.
  const vn = await mcpCall(token, "get_media", { connection_id: connectionId, chat_id: "ana", message_id: "vn" })
  const vnAbout = JSON.parse(vn.content[0]!.text!)
  assert.equal(vnAbout.file_name, "voice-note-vn.ogg")
  assert.equal(vnAbout.save_with, `curl -fsSL -o 'voice-note-vn.ogg' '${vnAbout.download_url}'`)
  const file = vn.content[1] as { type: string; resource: { uri: string; mimeType: string; blob: string } }
  assert.deepEqual([file.type, file.resource.uri, file.resource.mimeType], ["resource", "parley://media/voice-note-vn.ogg", "audio/ogg"])
  assert.equal(Buffer.from(file.resource.blob, "base64").toString(), "OggS-voice")
  assert.ok(!vn.content.some((b) => b.type === "audio"))
  assert.equal(await (await fetch(vnAbout.download_url)).text(), "OggS-voice")

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

test("load_history: asks the phone for the N before the oldest message Parley has, adds what it never had, fills in what it had without media, and each call goes further back", async () => {
  const { accountId, connectionId } = await linked("history@parley.test")
  const at = (m: number) => new Date(Date.parse("2026-11-04T01:00:00Z") + m * 60_000).toISOString()
  await assert.rejects(sessions.loadHistory(accountId, connectionId, "ana", 5), /no message in this chat to count back from/)
  // Stored by older code: a photo with no media info, then a reply.
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0) })
  fake.simulator.deliver(connectionId, { id: "t", threadId: "ana", from: "me", fromMe: true, text: "nice", at: at(5) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (m) => m.length === 2)

  const pending = sessions.loadHistory(accountId, connectionId, "ana", 4)
  const [req] = await waitUntil(async () => fake.simulator.backfills(connectionId), (b) => b.length === 1)
  // As WhatsApp's own "get older messages": the oldest stored message is the anchor, and N are asked for before it.
  assert.deepEqual([req!.anchor.threadId, req!.anchor.messageId, req!.anchor.fromMe, req!.count], ["ana", "p", false, 4])

  // The phone's answer: a message Parley never had, and the photo again, now with its attachment and a reaction.
  const reaction = { threadId: "ana", messageId: "p", from: "me", fromMe: true, emoji: "❤️", at: at(1) }
  fake.simulator.deliver(connectionId, { id: "lost", threadId: "ana", from: "ana", text: "did you get this?", at: at(-3) })
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0), media: { ...photo, ref: "late", thumbnail: "dGh1bWI=" }, reactions: [reaction] })
  const { answered, messages } = await pending
  assert.equal(answered, true)
  // What came back, up to the anchor (not the chat's latest).
  assert.deepEqual(messages.map((m) => m.id), ["lost", "p"])
  const p = messages.find((m) => m.id === "p")!
  assert.equal(p.media?.kind, "image")
  assert.deepEqual(p.reactions.map((r) => r.emoji), ["❤️"])
  assert.equal((await sessions.mediaInfo(accountId, connectionId, "ana", "p")).thumbnail, "dGh1bWI=")
  // Seen once more without a preview: what's stored stays.
  fake.simulator.deliver(connectionId, { id: "p", threadId: "ana", from: "ana", text: "[photo]", at: at(0), media: { ...photo, ref: "later" } })
  await sessions.settled()
  assert.equal((await sessions.mediaInfo(accountId, connectionId, "ana", "p")).thumbnail, "dGh1bWI=")

  // The next call counts back from the oldest message now stored, further back. Unanswered, it returns the latest.
  const again = sessions.loadHistory(accountId, connectionId, "ana", 4)
  const next = (await waitUntil(async () => fake.simulator.backfills(connectionId), (b) => b.length === 2)).at(-1)!
  assert.equal(next.anchor.messageId, "lost")
  void again.catch(() => {})

  const other = await store.upsertAccount(sql, { subject: "local:nosy2@parley.test", email: "nosy2@parley.test", name: "N", signedInWith: "local" })
  await assert.rejects(sessions.loadHistory(other.id, connectionId, "ana", 5), /not your connection/)
})

test("an ignored chat's messages are kept privately: agents can't see, search, react in or send to it; turned back on, its history is all there", async () => {
  const { accountId, connectionId } = await linked("private@parley.test")
  const at = (m: number) => new Date(Date.parse("2026-11-04T01:00:00Z") + m * 60_000).toISOString()
  fake.simulator.deliver(connectionId, { id: "g1", threadId: "team", from: "bo", text: "plans for sunday", at: at(0) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10, chatId: "team" }), (m) => m.length === 1)
  await setIgnored(sql, connectionId, ["team"], true)
  // More arrives while it's ignored: kept, never shown.
  fake.simulator.deliver(connectionId, { id: "g2", threadId: "team", from: "cy", text: "secret stuff", at: at(5) })
  await waitUntil(async () => (await sql(`select 1 from parley.message where connection_id = $1 and chat_id = 'team'`, [connectionId])).length, (n) => n === 2)
  assert.deepEqual(await sessions.inbox(accountId, { limit: 10, chatId: "team" }), [])
  assert.deepEqual(await sessions.inbox(accountId, { limit: 10, search: { words: ["secret"] } }), [])
  assert.ok(!(await sessions.inboxChats(accountId)).some((c) => c.id === "team"))
  await assert.rejects(sessions.messages(accountId, connectionId, "team", { limit: 10 }), /no such synced chat/)
  await assert.rejects(sessions.loadHistory(accountId, connectionId, "team", 10), /no such synced chat/)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "team", text: "hi" }), /ignored this chat/)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "team", text: "👍", reactTo: "g2" }), /ignored this chat/)

  // Turned back on: everything is there, no fetching needed.
  await setIgnored(sql, connectionId, ["team"], false)
  assert.deepEqual((await sessions.inbox(accountId, { limit: 10, chatId: "team" })).map((m) => m.text), ["secret stuff", "plans for sunday"])
  assert.equal((await sessions.chats(accountId, connectionId)).find((c) => c.id === "team")!.canLoadHistory, true)
  // load_history counts back from the oldest stored message.
  const before = fake.simulator.backfills(connectionId).length
  void sessions.loadHistory(accountId, connectionId, "team", 10).catch(() => {})
  const req = (await waitUntil(async () => fake.simulator.backfills(connectionId), (b) => b.length === before + 1)).at(-1)!
  assert.deepEqual([req.anchor.messageId, req.count], ["g1", 10])
})

test("a chat that was never stored and has no bookmark says it can't load history yet", async () => {
  const { accountId, connectionId } = await linked("nohistory@parley.test")
  await sql(`update parley.chat set last_message_at = now() where connection_id = $1 and id = 'team'`, [connectionId])
  const team = (await sessions.chats(accountId, connectionId)).find((c) => c.id === "team")!
  assert.equal(team.canLoadHistory, false)
  await assert.rejects(sessions.loadHistory(accountId, connectionId, "team", 5), /ignored when its messages came in/)
})

test("deleting a sent message for everyone: by its outbox id or its inbox id, paced, only the account's own and only for ~2 days", async () => {
  const email = "unsend@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const hour = 60 * 60 * 1000
  const at = (ms: number) => new Date(T0.getTime() + ms)
  // "mine" is deleted over MCP below, which judges the two-day window by the real clock, so it's an hour old by that clock.
  fake.simulator.deliver(connectionId, { id: "mine", threadId: "ana", from: "me", fromMe: true, text: "typo", at: new Date(Date.now() - hour).toISOString() })
  fake.simulator.deliver(connectionId, { id: "hers", threadId: "ana", from: "ana", text: "hi", at: at(-hour).toISOString() })
  fake.simulator.deliver(connectionId, { id: "old", threadId: "ana", from: "me", fromMe: true, text: "ages ago", at: at(-49 * hour).toISOString() })
  // "edge" is queued after that deletion took the real clock's slot, so its window has to outlast that slot, whatever today is.
  fake.simulator.deliver(connectionId, { id: "edge", threadId: "ana", from: "me", fromMe: true, text: "aging", at: new Date(Date.now() - 2 * hour).toISOString() })
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => ms.length === 4)
  const dispatch = async (q: { message: { scheduledFor: string | null } }) => sessions.dispatchDue(new Date(Date.parse(q.message.scheduledFor!) + 1000))

  // One sent through Parley, deleted by the id send_message returned.
  const sent = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "wrong chat" }, T0)
  await dispatch(sent)
  const externalId = `msg-${fake.simulator.sent(connectionId).length}`
  const del = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "ignored", unsend: sent.message.id }, T0)
  assert.equal(del.message.unsend, externalId)
  assert.equal(del.message.kind, "message")
  assert.equal(del.message.text, "")
  await dispatch(del)
  assert.deepEqual(fake.simulator.sent(connectionId).at(-1)!.content.unsend, { messageId: externalId, fromMe: true })
  assert.equal((await getOutbound(sql, accountId, del.message.id)).status, "sent")
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: sent.message.id }, T0), /already being deleted/)

  // One from the phone, by its read_inbox id, over MCP: gone from the inbox once it's out.
  const viaMcp = await callTool(base, token, "delete_message", { connection_id: connectionId, chat_id: "ana", message_id: "mine" })
  assert.equal(viaMcp.isError, false, String(viaMcp.result))
  assert.equal(viaMcp.result.deletes, "mine")
  // In the account's active hours its slot is now, and the worker sends it right away in the background; otherwise
  // the pass at its slot does. Either way, wait for it to be out.
  await dispatch({ message: { scheduledFor: viaMcp.result.scheduled_for } })
  await waitUntil(() => getOutbound(sql, accountId, viaMcp.result.id), (m) => m.status === "sent")
  assert.deepEqual(fake.simulator.sent(connectionId).at(-1)!.content.unsend, { messageId: "mine", fromMe: true })
  assert.ok(!(await sessions.inbox(accountId, { limit: 10 })).some((m) => m.id === "mine"))
  assert.match((await callTool(base, token, "message_status", { message_id: viaMcp.result.id })).result.note, /The deletion went out/)

  // Not someone else's, not a stale one, not one still queued (cancel that), and a read_inbox id needs its chat.
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: "hers" }, T0), /only messages the account sent/)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: "old" }, T0), /about two days/)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: "nope" }, T0), /no such message/)
  assert.match((await callTool(base, token, "delete_message", { message_id: "mine" })).result, /pass chat_id/)

  // Queued in time, but by the time its slot comes up it's too late (here: the message turns out older than it was
  // when queued): it fails without reaching the platform.
  const before = fake.simulator.sent(connectionId).length
  const late = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: "edge" }, T0)
  await sql(`update parley.message set sent_at = $2 where connection_id = $1 and id = 'edge'`, [connectionId, at(-49 * hour)])
  await dispatch(late)
  assert.equal(fake.simulator.sent(connectionId).length, before)
  const failed = await getOutbound(sql, accountId, late.message.id)
  assert.equal(failed.status, "failed")
  assert.equal(failed.error?.code, "too_late")

  const queued = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "later", notBefore: at(5 * hour) }, T0)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: queued.message.id }, T0), /cancel_message/)

  // The other person deleting theirs: it drops out of the inbox, reactions and all.
  fake.simulator.unsend(connectionId, [{ threadId: "ana", messageId: "hers" }])
  await waitUntil(() => sessions.inbox(accountId, { limit: 10 }), (ms) => !ms.some((m) => m.id === "hers"))
})

test("a channel that can't delete sent messages refuses up front", async () => {
  const { accountId, connectionId } = await linked("unsend-txt@parley.test", "fake-txt", textOnly.simulator)
  textOnly.simulator.deliver(connectionId, { id: "t1", threadId: "ana", from: "me", fromMe: true, text: "hey" })
  await waitUntil(() => sessions.inbox(accountId, { limit: 5 }), (ms) => ms.length === 1)
  await assert.rejects(sessions.enqueue(accountId, connectionId, { to: "ana", text: "", unsend: "t1" }, T0), /can't delete sent messages/)
})

test("GIFs go out as people send them: converted to MP4 and sent as a looping GIF, from base64 or a URL; an MP4 can be marked a GIF", async () => {
  const email = "gif@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  const sendAt = async (q: { message: { scheduledFor: string | null } }) => sessions.dispatchDue(new Date(Date.parse(q.message.scheduledFor!) + 1000))

  // Through MCP, as base64: the edge sees a GIF, the sessions service converts it.
  const res = await callTool(base, token, "send_message", { connection_id: connectionId, to: "ana", text: "this", media: { data: GIF.toString("base64"), file_name: "dance.gif" } })
  assert.equal(res.isError, false, String(res.result))
  assert.deepEqual(res.result.media, { kind: "video", mimetype: "video/mp4", file_name: null })
  await sessions.dispatchDue(new Date(Date.parse(res.result.scheduled_for) + 1000))
  const out = fake.simulator.sent(connectionId).at(-1)!.content
  assert.equal(out.text, "this")
  assert.deepEqual([out.media?.kind, out.media?.mimetype, out.media?.gif], ["video", "video/mp4", true])
  assert.ok(isMp4(out.media!.data))

  // From a URL that serves image/gif.
  const viaUrl = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { url: "https://media.example.com/dance.gif" } }, T0)
  await sendAt(viaUrl)
  const fromUrl = fake.simulator.sent(connectionId).at(-1)!.content.media!
  assert.deepEqual([fromUrl.kind, fromUrl.mimetype, fromUrl.gif], ["video", "video/mp4", true])
  assert.ok(isMp4(fromUrl.data))

  // An MP4 GIF (Giphy/Tenor) with gif: true goes as it is, looping.
  const mp4 = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { url: "https://media.example.com/dance.mp4", gif: true } }, T0)
  await sendAt(mp4)
  const last = fake.simulator.sent(connectionId).at(-1)!.content.media!
  assert.deepEqual([last.kind, last.mimetype, last.gif, new TextDecoder().decode(last.data)], ["video", "video/mp4", true, "mp4-bytes"])

  // Asked for as a document, a GIF stays the file it is.
  const doc = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "", media: { data: new Uint8Array(GIF), kind: "document", mimetype: "image/gif", fileName: "dance.gif" } }, T0)
  await sendAt(doc)
  const asDoc = fake.simulator.sent(connectionId).at(-1)!.content.media!
  assert.deepEqual([asDoc.kind, asDoc.mimetype, asDoc.gif], ["document", "image/gif", undefined])
})

test("sent messages are kept for resend requests, so a device that couldn't decrypt one still gets it after a restart", async () => {
  const { accountId, connectionId } = await linked("resend@parley.test")
  const q = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "did you get this?" }, T0)
  await sessions.dispatchDue(new Date(Date.parse(q.message.scheduledFor!) + 1000))
  const id = `msg-${fake.simulator.sent(connectionId).length}`
  const stored = await waitUntil(() => fake.simulator.requestResend(connectionId, id), (m) => Boolean(m))
  assert.deepEqual(JSON.parse(new TextDecoder().decode(stored)), { to: "ana", text: "did you get this?" })
  assert.equal(await fake.simulator.requestResend(connectionId, "never-sent"), undefined)

  // A month on, it's pruned (the next send clears the old ones).
  await sql(`update parley.sent_message set sent_at = now() - interval '31 days' where connection_id = $1`, [connectionId])
  const next = await sessions.enqueue(accountId, connectionId, { to: "ana", text: "again" }, T0)
  await sessions.dispatchDue(new Date(Date.parse(next.message.scheduledFor!) + 60_000))
  await waitUntil(() => fake.simulator.requestResend(connectionId, id), (m) => m === undefined)
})
