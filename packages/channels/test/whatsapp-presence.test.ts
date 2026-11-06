import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"

// While a linked device is online, WhatsApp stops pushing notifications to the phone. Unpatched Baileys 7.0.0-rc14 sent
// a presence with no type (read as "available") on every partial creds.update, so the number showed "Active" and the
// phone went quiet right after linking. scripts/patch-baileys.ts fixes that; this fails if an install ships without it.
test("Baileys never announces the account online on a creds update", () => {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve("@whiskeysockets/baileys/package.json"))
  const src = readFileSync(join(root, "lib/Socket/socket.js"), "utf8")
  const handler = src.slice(src.indexOf("ev.on('creds.update'"), src.indexOf("Object.assign(creds, update);"))
  assert.ok(handler.length > 0, "creds.update handler not found")
  assert.match(handler, /if \(name && creds\.me\?\.name !== name\)/, "a partial update (no name) must not send a presence")
  assert.match(handler, /type: 'unavailable'/, "a name change must announce unavailable, not an untyped (available) presence")
})
