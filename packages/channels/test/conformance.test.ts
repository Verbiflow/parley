import assert from "node:assert/strict"
import { test } from "node:test"
import { makeFakeChannel } from "../src/fake.ts"
import { CHECKS, runChannelConformance } from "../src/conformance.ts"

// The default Fake (QR link) must pass every check.
const qr = await runChannelConformance(() => makeFakeChannel())
for (const name of CHECKS) {
  test(`fake (qr): ${name}`, () => {
    const result = qr.find((r) => r.name === name)
    assert.ok(result, "no result recorded")
    assert.equal(result.status, "passed", result.detail)
  })
}

// Extensibility: a second channel declaring a different link method conforms with zero changes to the suite.
test("a second channel with a different link method also conforms", async () => {
  const oauth = await runChannelConformance(() => makeFakeChannel("fake-oauth", { linkMethod: "oauth" }))
  const failed = oauth.filter((r) => r.status !== "passed")
  assert.equal(failed.length, 0, JSON.stringify(failed))
})
