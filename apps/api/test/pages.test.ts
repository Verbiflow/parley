import assert from "node:assert/strict"
import { test } from "node:test"
import { chatsPage, dashboardPage, landingPage, type AgentView } from "../src/web/pages.ts"
import type { Connection } from "../src/sessions/store.ts"
import type { ActivityEntry } from "../src/sessions/outbox.ts"

test("the app's sign-in page is the centered panel with one Google button", () => {
  const html = landingPage({ workos: true, dev: false })
  assert.match(html, /Your messaging, ready for your agents\./)
  assert.match(html, /href="\/auth\/start"[^>]*>.*Continue with Google/s)
  assert.doesNotMatch(html, /name="email"|Sign-in isn't set up/)
  const local = landingPage({ workos: false, dev: true })
  assert.match(local, /action="\/auth\/dev"/)
  assert.doesNotMatch(local, /WORKOS_|Sign-in isn't/)
  assert.doesNotMatch(html, /Messaging infrastructure<br>/)
})

test("the overview with two WhatsApp numbers lists both, offers another, and says which number sent what", () => {
  const conn = (id: string, handle: string): Connection => ({
    id, accountId: "a", channel: "whatsapp", status: "connected", handle, displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: null }, timezone: "Asia/Singapore", country: "SG", haltedReason: null, pausedUntil: null, dailyLimit: 100, readReceipts: true, typing: true, avatar: null,
  })
  const agent: AgentView = { sessionId: "s", clientName: "Claude", clientId: "c", connectedAt: "2026-11-01T00:00:00Z", lastRefreshedAt: "2026-11-01T00:00:00Z", lastUsedAt: null, lastTool: null, lastToolAt: null, calls: 0 }
  const sent: ActivityEntry = { id: "m", at: "2026-11-02T00:00:00Z", agent: "Claude", connectionId: "home", chatId: "447700900999@s.whatsapp.net", kind: "message", text: "hi", status: "sent", media: null, reactTo: null, unsend: null, typing: false, scheduledFor: null, sentAt: "2026-11-02T00:00:00Z", attempts: 1, error: null, createdAt: "2026-11-02T00:00:00Z" }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net"), conn("home", "447700900111:3@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [sent] })
  assert.match(html, /\+65 9136 3557/)
  assert.match(html, /\+44 7700 900111/)
  assert.match(html, /class="acard add"/)
  assert.match(html, /title="iMessage, coming soon"/)
  assert.match(html, /action="\/app\/connect"/)
  assert.match(html, /<td class="fr">\+44 7700 900111<\/td>\s*<td class="to">\+44 7700 900999<\/td>/)
  assert.match(html, /data-live="\/app\/activity\/feed\?compact=1"/)
  const solo = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [{ ...sent, connectionId: "work" }] })
  assert.doesNotMatch(solo, /class="fr"/)
})

test("a number's card shows its profile picture with a small WhatsApp badge, else the WhatsApp logo", () => {
  const conn = (avatar: string | null): Connection => ({
    id: "work", accountId: "a", channel: "whatsapp", status: "connected", handle: "6591363557:7@s.whatsapp.net", displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: null }, timezone: "Asia/Singapore", country: "SG", haltedReason: null, pausedUntil: null, dailyLimit: 100, readReceipts: true, typing: true, avatar,
  })
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const page = (avatar: string | null) => dashboardPage({ user, connections: [conn(avatar)], agents: [], mcpUrl: "https://x/mcp", recent: [] })
  const withDp = page("data:image/jpeg;base64,AAAA")
  assert.match(withDp, /<span class="ct dp"><img src="data:image\/jpeg;base64,AAAA"[^>]*><span class="badge"><svg class="cm"/)
  const without = page(null)
  assert.doesNotMatch(without, /class="ct dp"/)
  assert.match(without, /<div class="ah"><span class="ct"><svg class="cm"/)
})

test("an account page shows its chats with the daily limit and disconnect on top", () => {
  const conn: Connection = {
    id: "work", accountId: "a", channel: "whatsapp", status: "connected", handle: "6591363557:7@s.whatsapp.net", displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: "2026-11-01T00:01:00Z" }, timezone: "America/Los_Angeles", country: "US", haltedReason: null, pausedUntil: null, dailyLimit: 100, readReceipts: true, typing: true, avatar: null,
  }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = chatsPage({ user, connection: conn, chats: [], agentCount: 1, saved: false, today: { sentToday: 7, dailyLimit: 100 }, queued: 2, webhooks: { webhooks: [], deliveries: [] } })
  assert.match(html, /\+65 9136 3557/)
  assert.match(html, /name="daily_limit"[^>]*value="100"/)
  assert.match(html, /7<span class="faint"> \/ 100 sent today/)
  assert.match(html, /action="\/app\/connections\/work\/disconnect"/)
  assert.doesNotMatch(html, /<input(?![^>]*type="hidden")[^>]*name="(timezone|country)"/)
  assert.doesNotMatch(html, /New conversations/)
})
