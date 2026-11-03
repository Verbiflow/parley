import assert from "node:assert/strict"
import { test } from "node:test"
import { makeAuthState } from "../src/whatsapp/auth-state.ts"

test("WhatsApp auth state round-trips through serialization (binary keys preserved)", () => {
  const fresh = makeAuthState()
  const serialized = fresh.serialize()
  assert.equal(typeof serialized, "string")

  const restored = makeAuthState(serialized)
  // Scalars survive.
  assert.equal(restored.state.creds.registrationId, fresh.state.creds.registrationId)
  // Binary keypairs survive as Buffers with identical bytes (this is what breaks with naive JSON).
  const a = fresh.state.creds.noiseKey.private as Buffer
  const b = restored.state.creds.noiseKey.private as Buffer
  assert.ok(Buffer.isBuffer(b), "expected a Buffer after revival")
  assert.equal(Buffer.compare(a, b), 0)
})

test("the key store persists values set on it across serialization", () => {
  const first = makeAuthState()
  // Simulate Baileys storing a signal key.
  first.state.keys.set({ "pre-key": { "1": { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } } } as never)
  const restored = makeAuthState(first.serialize())
  const got = restored.state.keys.get("pre-key" as never, ["1"]) as Record<string, { public: Buffer }>
  assert.equal(Buffer.compare(got["1"]!.public as Buffer, Buffer.from([1, 2, 3])), 0)
})
