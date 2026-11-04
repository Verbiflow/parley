import assert from "node:assert/strict"
import { test } from "node:test"
import type { WAMessage } from "@whiskeysockets/baileys"
import { proto } from "@whiskeysockets/baileys"
import { textOf, mediaOf, messageOfRef, reactionOf, revokedOf, embeddedReactions, mp4Seconds } from "../src/whatsapp/parse.ts"

const key = { remoteJid: "447700900123@s.whatsapp.net", id: "ABC", fromMe: false }

test("a photo: caption as text, media described, and a ref that rebuilds a downloadable message", () => {
  const m: WAMessage = {
    key,
    message: { imageMessage: { caption: "sunset", mimetype: "image/jpeg", width: 1200, height: 900, fileLength: 54321, mediaKey: new Uint8Array([1, 2, 3]), directPath: "/v/t62/abc", url: "https://mmg.whatsapp.net/abc", jpegThumbnail: new Uint8Array(500) } },
  }
  assert.equal(textOf(m), "sunset")
  const media = mediaOf(m)!
  assert.deepEqual({ ...media, ref: undefined }, { kind: "image", mimetype: "image/jpeg", fileName: null, size: 54321, width: 1200, height: 900, seconds: null, ref: undefined, thumbnail: Buffer.from(new Uint8Array(500)).toString("base64") })
  const back = messageOfRef(media.ref)
  assert.equal(back.key.id, "ABC")
  assert.equal(back.message?.imageMessage?.directPath, "/v/t62/abc")
  assert.deepEqual([...back.message!.imageMessage!.mediaKey!], [1, 2, 3])
  // No thumbnail or caption in the ref: it's only what a download needs.
  assert.equal(back.message!.imageMessage!.jpegThumbnail?.length ?? 0, 0)
  assert.equal(back.message!.imageMessage!.caption ?? "", "")
})

test("media without a key can't be fetched, so it isn't offered; a voice note reads as one", () => {
  assert.equal(mediaOf({ key, message: { videoMessage: { mimetype: "video/mp4" } } }), undefined)
  assert.equal(textOf({ key, message: { videoMessage: { mimetype: "video/mp4" } } }), "[video]")
  const voice: WAMessage = { key, message: { audioMessage: { ptt: true, seconds: 7, mimetype: "audio/ogg; codecs=opus", mediaKey: new Uint8Array([9]), directPath: "/v/x" } } }
  assert.equal(textOf(voice), "[voice message]")
  assert.equal(mediaOf(voice)?.kind, "audio")
  assert.equal(mediaOf(voice)?.seconds, 7)
  assert.equal(mediaOf({ key, message: { conversation: "hi" } }), undefined)
})

test("reactions: a live reaction message, and the ones history carries on a message", () => {
  const live: WAMessage = {
    key: { remoteJid: "123@g.us", id: "R1", fromMe: false, participant: "447700900999@s.whatsapp.net" },
    message: { reactionMessage: { key: { remoteJid: "123@g.us", id: "TARGET" }, text: "👍", senderTimestampMs: 1762200000000 } },
    messageTimestamp: 1762200000,
  }
  assert.equal(textOf(live), undefined)
  const r = reactionOf(live)!
  assert.equal(r.target, "TARGET")
  assert.equal(r.emoji, "👍")
  assert.equal(r.atMs, 1762200000000)
  assert.equal(r.reactor.participant, "447700900999@s.whatsapp.net")

  const removed = reactionOf({ ...live, message: { reactionMessage: { key: { id: "TARGET" }, text: "" } } })!
  assert.equal(removed.emoji, "")

  const history: WAMessage = { key, message: { conversation: "hello" }, reactions: [{ key: { remoteJid: key.remoteJid, fromMe: true, id: "R2" }, text: "❤️", senderTimestampMs: 1762100000000 }] }
  assert.deepEqual(embeddedReactions(history).map((x) => [x.target, x.emoji, x.reactor.fromMe]), [["ABC", "❤️", true]])
})

test("an MP4's length comes from its movie header (v0 and v1), and anything else has none", () => {
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length)
    new DataView(out.buffer).setUint32(0, out.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(body, 8)
    return out
  }
  const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length } return o }
  const mvhd0 = new Uint8Array(100); new DataView(mvhd0.buffer).setUint32(12, 1000); new DataView(mvhd0.buffer).setUint32(16, 42_400)
  const mvhd1 = new Uint8Array(112); mvhd1[0] = 1; new DataView(mvhd1.buffer).setUint32(20, 600); new DataView(mvhd1.buffer).setBigUint64(24, 600n * 90n)
  const ftyp = box("ftyp", new Uint8Array(16))
  assert.equal(mp4Seconds(cat(ftyp, box("mdat", new Uint8Array(50)), box("moov", box("mvhd", mvhd0)))), 42)
  assert.equal(mp4Seconds(cat(ftyp, box("moov", cat(box("trak", new Uint8Array(4)), box("mvhd", mvhd1))))), 90)
  assert.equal(mp4Seconds(new TextEncoder().encode("not a video at all")), undefined)
  assert.equal(mp4Seconds(ftyp), undefined)
})

test("a delete-for-everyone names the message it takes back, and isn't a message itself", () => {
  const revoke: WAMessage = { key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { remoteJid: key.remoteJid, id: "GONE", fromMe: false } } } }
  assert.equal(revokedOf(revoke), "GONE")
  assert.equal(textOf(revoke), undefined)
  assert.equal(revokedOf({ key, message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION } } }), undefined)
  assert.equal(revokedOf({ key, message: { conversation: "hi" } }), undefined)
})
