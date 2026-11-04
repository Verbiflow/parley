import assert from "node:assert/strict"
import { test } from "node:test"
import { isPrivateHost, kindOf, resolveMedia, MAX_SEND_BYTES } from "../src/mcp/media.ts"

test("private and metadata addresses are refused; public ones aren't", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]", "fd00::1", "metadata.google.internal", "100.64.0.1"]) assert.ok(isPrivateHost(h), h)
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "cdn.example.org"]) assert.ok(!isPrivateHost(h), h)
})

test("kinds follow the type: inline photos/videos, audio, everything else a document", () => {
  assert.equal(kindOf("image/jpeg"), "image")
  assert.equal(kindOf("video/mp4"), "video")
  assert.equal(kindOf("audio/ogg; codecs=opus"), "audio")
  assert.equal(kindOf("image/gif"), "document")
  assert.equal(kindOf("application/pdf"), "document")
})

test("a URL is downloaded with its served type and name; base64 decodes; size and shape are checked", async () => {
  const fetchFn = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } })) as unknown as typeof fetch
  const v = await resolveMedia({ url: "https://cdn.example.com/clips/demo.mp4" }, fetchFn)
  assert.deepEqual({ kind: v.kind, mimetype: v.mimetype, fileName: v.fileName, n: v.data.byteLength }, { kind: "video", mimetype: "video/mp4", fileName: "demo.mp4", n: 3 })

  const b = await resolveMedia({ data: `data:image/png;base64,${Buffer.from("hi").toString("base64")}`, file_name: "x.png" })
  assert.equal(b.mimetype, "image/png")
  assert.equal(new TextDecoder().decode(b.data), "hi")

  await assert.rejects(resolveMedia({}), /exactly one/)
  await assert.rejects(resolveMedia({ url: "ftp://example.com/a" }), /http/)
  await assert.rejects(resolveMedia({ data: "!!!" }), /base64/)
  const huge = (async () => new Response("x", { headers: { "content-length": String(MAX_SEND_BYTES + 1) } })) as unknown as typeof fetch
  await assert.rejects(resolveMedia({ url: "https://example.com/big.mp4" }, huge), /at most/)
  const missing = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch
  await assert.rejects(resolveMedia({ url: "https://example.com/gone.jpg" }, missing), /HTTP 404/)
})
