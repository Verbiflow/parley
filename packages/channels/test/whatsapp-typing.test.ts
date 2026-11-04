import assert from "node:assert/strict"
import { test } from "node:test"
import { typingMs, TYPING_MAX_MS } from "../src/whatsapp/index.ts"

const mid = () => 0.5 // no jitter

test("typing lasts as long as the message takes at 50 wpm: ~24s per 100 characters", () => {
  assert.equal(typingMs({ text: "x".repeat(100) }, mid), 24_000)
  assert.equal(typingMs({ text: "x".repeat(50) }, mid), 12_000)
})

test("a short message still gets a beat; a long one stops at a minute", () => {
  assert.equal(typingMs({ text: "ok" }, mid), 1500)
  assert.equal(typingMs({ text: "x".repeat(5000) }, mid), TYPING_MAX_MS)
})

test("jitter stays within ±15%", () => {
  assert.equal(typingMs({ text: "x".repeat(100) }, () => 0), 20_400)
  assert.equal(typingMs({ text: "x".repeat(100) }, () => 1), 27_600)
})

test("before a voice note it records for as long as it plays", () => {
  assert.equal(typingMs({ text: "", media: { kind: "audio", data: new Uint8Array(), mimetype: "audio/ogg", seconds: 9 } }, mid), 9000)
})
