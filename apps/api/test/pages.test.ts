import assert from "node:assert/strict"
import { test } from "node:test"
import { chatsPage, dashboardPage, landingPage, marketingPage, type AgentView } from "../src/web/pages.ts"
import type { Connection } from "../src/sessions/store.ts"
import type { Outbound } from "../src/sessions/outbox.ts"

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

test("the overview with two WhatsApp numbers lists both, offers another, and says which number sent what", () => {
  const conn = (id: string, handle: string): Connection => ({
    id, accountId: "a", channel: "whatsapp", status: "connected", handle, displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: null }, timezone: "Asia/Singapore", country: "SG", haltedReason: null, pausedUntil: null, dailyLimit: 100,
  })
  const agent: AgentView = { sessionId: "s", clientName: "Claude", clientId: "c", connectedAt: "2026-11-01T00:00:00Z", lastRefreshedAt: "2026-11-01T00:00:00Z", lastUsedAt: null, lastTool: null, lastToolAt: null, calls: 0 }
  const sent: Outbound = { id: "m", connectionId: "home", chatId: "447700900999@s.whatsapp.net", kind: "message", text: "hi", status: "sent", media: null, reactTo: null, unsend: null, scheduledFor: null, sentAt: "2026-11-02T00:00:00Z", attempts: 1, error: null, createdAt: "2026-11-02T00:00:00Z" }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net"), conn("home", "447700900111:3@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [sent] })
  assert.match(html, /\+65 9136 3557/)
  assert.match(html, /\+44 7700 900111/)
  assert.match(html, /class="chtag"/)
  assert.match(html, /class="chtag soon"/)
  assert.doesNotMatch(html, /Connect WhatsApp/)
  assert.match(html, /action="\/app\/connect"/)
  assert.match(html, /class="fr">\+44 7700 900111<\/span><span class="to">→/)
  const solo = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [{ ...sent, connectionId: "work" }] })
  assert.doesNotMatch(solo, /class="fr"/)
})

test("an account page shows its chats with the daily limit and disconnect on top", () => {
  const conn: Connection = {
    id: "work", accountId: "a", channel: "whatsapp", status: "connected", handle: "6591363557:7@s.whatsapp.net", displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: "2026-11-01T00:01:00Z" }, timezone: "America/Los_Angeles", country: "US", haltedReason: null, pausedUntil: null, dailyLimit: 100,
  }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = chatsPage({ user, connection: conn, chats: [], agentCount: 1, saved: false, today: { sentToday: 7, dailyLimit: 100 }, queued: 2 })
  assert.match(html, /\+65 9136 3557/)
  assert.match(html, /name="daily_limit"[^>]*value="100"/)
  assert.match(html, /7<span class="faint"> \/ 100 sent today/)
  assert.match(html, /action="\/app\/connections\/work\/disconnect"/)
  assert.doesNotMatch(html, /name="timezone"|name="country"/)
  assert.doesNotMatch(html, /New conversations/)
})
