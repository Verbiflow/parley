import assert from "node:assert/strict"
import { test } from "node:test"
import type { WAMessage } from "@whiskeysockets/baileys"
import { textOf, mediaOf, messageOfRef, reactionOf, embeddedReactions } from "../src/whatsapp/parse.ts"

const key = { remoteJid: "447700900123@s.whatsapp.net", id: "ABC", fromMe: false }

test("a photo: caption as text, media described, and a ref that rebuilds a downloadable message", () => {
  const m: WAMessage = {
    key,
    message: { imageMessage: { caption: "sunset", mimetype: "image/jpeg", width: 1200, height: 900, fileLength: 54321, mediaKey: new Uint8Array([1, 2, 3]), directPath: "/v/t62/abc", url: "https://mmg.whatsapp.net/abc", jpegThumbnail: new Uint8Array(500) } },
  }
  assert.equal(textOf(m), "sunset")
  const media = mediaOf(m)!
  assert.deepEqual({ ...media, ref: undefined }, { kind: "image", mimetype: "image/jpeg", fileName: null, size: 54321, width: 1200, height: 900, seconds: null, ref: undefined })
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
