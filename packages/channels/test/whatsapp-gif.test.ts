import assert from "node:assert/strict"
import { test } from "node:test"
import { contentFor } from "../src/whatsapp/index.ts"

test("a GIF goes as a video with gifPlayback, the way WhatsApp's GIF tab sends one; a plain video doesn't", () => {
  const data = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70])
  const gif = contentFor("ana@s.whatsapp.net", { text: "lol", media: { kind: "video", mimetype: "video/mp4", data, gif: true, seconds: 2 } }) as Record<string, unknown>
  assert.ok(Buffer.isBuffer(gif.video))
  assert.equal(gif.gifPlayback, true)
  assert.equal(gif.caption, "lol")
  const clip = contentFor("ana@s.whatsapp.net", { text: "", media: { kind: "video", mimetype: "video/mp4", data, seconds: 2 } }) as Record<string, unknown>
  assert.equal(clip.gifPlayback, undefined)
})
