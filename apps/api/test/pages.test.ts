import assert from "node:assert/strict"
import { test } from "node:test"
import { landingPage, marketingPage } from "../src/web/pages.ts"

test("the marketing site only links to the app; it never starts sign-in itself", () => {
  const html = marketingPage({ appUrl: "https://app.itsparley.com" })
  assert.match(html, /Give your agents a phone number/)
  assert.match(html, /href="https:\/\/app\.itsparley\.com"[^>]*>Open app/)
  assert.doesNotMatch(html, /\/auth\/start/)
  assert.doesNotMatch(html, /Welcome to Parley/)
})

test("the app's sign-in page is the centered panel with one Google button", () => {
  const html = landingPage({ workos: true, dev: false })
  assert.match(html, /Your messaging, ready for your agents\./)
  assert.match(html, /href="\/auth\/start"[^>]*>.*Continue with Google/s)
  assert.doesNotMatch(html, /dev login/)
  assert.doesNotMatch(html, /Give your agents a phone number/)
})
