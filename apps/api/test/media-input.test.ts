import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { describeMedia, isPrivateHost, kindOf, resolveMedia, MAX_SEND_BYTES } from "../src/mcp/media.ts"
import { fetchPublicMedia } from "../src/sessions/fetch-media.ts"
import { signMediaLink, verifyMediaLink, MEDIA_LINK_SECONDS } from "../src/media-link.ts"

test("private and metadata addresses are refused; public ones aren't", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]", "fd00::1", "metadata.google.internal", "100.64.0.1"]) assert.ok(isPrivateHost(h), h)
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "cdn.example.org"]) assert.ok(!isPrivateHost(h), h)
})

test("kinds follow the type: inline photos/videos, audio, everything else a document", () => {
  assert.equal(kindOf("image/jpeg"), "image")
  assert.equal(kindOf("video/mp4"), "video")
  assert.equal(kindOf("video/quicktime"), "video")
  assert.equal(kindOf("audio/ogg; codecs=opus"), "audio")
  assert.equal(kindOf("image/gif"), "document")
  assert.equal(kindOf("application/pdf"), "document")
  assert.equal(kindOf("application/zip"), "document")
})

test("the edge decodes base64 but only checks a URL (the sessions service downloads it)", () => {
  const b = resolveMedia({ data: `data:image/png;base64,${Buffer.from("hi").toString("base64")}`, file_name: "x.png" })
  assert.ok("data" in b)
  assert.equal(b.mimetype, "image/png")
  assert.equal(new TextDecoder().decode(b.data), "hi")
  assert.deepEqual(resolveMedia({ url: "https://cdn.example.com/a.mp4", kind: "video" }), { url: "https://cdn.example.com/a.mp4", kind: "video", mimetype: undefined, fileName: undefined })

  assert.throws(() => resolveMedia({}), /exactly one/)
  assert.throws(() => resolveMedia({ url: "ftp://example.com/a" }), /http/)
  assert.throws(() => resolveMedia({ url: "http://169.254.169.254/latest" }), /public internet/)
  assert.throws(() => resolveMedia({ data: "!!!" }), /base64/)
})

test("types come from the agent, the server, then the name; each kind has its size limit", () => {
  const d = (n: number) => new Uint8Array(n)
  assert.equal(describeMedia({ data: d(3), served: "video/mp4" }).kind, "video")
  assert.equal(describeMedia({ data: d(3), served: "application/octet-stream", fileName: "report.pdf" }).mimetype, "application/pdf")
  assert.equal(describeMedia({ data: d(3), fileName: "notes.bin" }).mimetype, "application/octet-stream")
  assert.throws(() => describeMedia({ data: d(0) }), /empty/)
  assert.throws(() => describeMedia({ data: d(MAX_SEND_BYTES + 1), mimetype: "image/jpeg" }), /image can be at most 16 MB/)
  assert.equal(describeMedia({ data: d(MAX_SEND_BYTES + 1), mimetype: "video/mp4" }).kind, "video")
})

test("the sessions-side downloader refuses names that resolve to private addresses, even after a redirect", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/hop") { res.writeHead(302, { location: "http://127.0.0.1/secret" }); res.end(); return }
    res.end("secret")
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as { port: number }).port
  try {
    // "localhost" passes no literal check of its own here: it's the resolved address that's refused.
    await assert.rejects(fetchPublicMedia(`http://localtest.me:${port}/x`, 1000), /public internet|couldn't download/)
    await assert.rejects(fetchPublicMedia(`http://127.0.0.1:${port}/x`, 1000), /public internet/)
    await assert.rejects(fetchPublicMedia(`http://[::1]:${port}/x`, 1000), /public internet/)
  } finally {
    server.close()
  }
})

test("download links: signed, scoped to one message, and they expire", async () => {
  const claims = { accountId: "acct", connectionId: "conn", chatId: "chat@g.us", messageId: "MSG1" }
  const now = Date.parse("2026-11-04T00:00:00Z")
  const { token, expiresAt } = await signMediaLink("secret-a", claims, now)
  assert.equal(expiresAt, new Date(now + MEDIA_LINK_SECONDS * 1000).toISOString())
  assert.deepEqual({ ...(await verifyMediaLink("secret-a", token, now))!, expiresAt: undefined }, { ...claims, expiresAt: undefined })
  assert.equal(await verifyMediaLink("secret-b", token, now), undefined)
  assert.equal(await verifyMediaLink("secret-a", token, now + (MEDIA_LINK_SECONDS + 1) * 1000), undefined)
  const [body, sig] = token.split(".")
  const forged = Buffer.from(JSON.stringify({ a: "other", c: "conn", t: "chat@g.us", m: "MSG1", e: 9e9 })).toString("base64url")
  assert.equal(await verifyMediaLink("secret-a", `${forged}.${sig}`, now), undefined)
  assert.equal(await verifyMediaLink("secret-a", `${body}`, now), undefined)
})
