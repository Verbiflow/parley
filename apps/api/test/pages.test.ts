import type { ChatRow } from "../src/sessions/chats.ts"
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
  assert.match(html, /<span title="WhatsApp">/)
  for (const name of ["iMessage", "Slack", "LinkedIn", "Gmail"]) assert.match(html, new RegExp(`aria-label="${name}, coming soon"`))
})

test("the overview with two WhatsApp numbers lists both, offers another, and says which number sent what", () => {
  const conn = (id: string, handle: string): Connection => ({
    id, accountId: "a", channel: "whatsapp", status: "connected", handle, displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: null }, timezone: "Asia/Singapore", country: "SG", haltedReason: null, pausedUntil: null, dailyLimit: 100, activeHours: false, gapSeconds: null, readReceipts: true, typing: true, avatar: null,
  })
  const agent: AgentView = { sessionId: "s", clientName: "Claude", clientId: "c", connectedAt: "2026-11-01T00:00:00Z", lastRefreshedAt: "2026-11-01T00:00:00Z", lastUsedAt: null, lastTool: null, lastToolAt: null, calls: 0 }
  const sent: ActivityEntry = { id: "m", at: "2026-11-02T00:00:00Z", agent: "Claude", connectionId: "home", chatId: "447700900999@s.whatsapp.net", kind: "message", text: "hi", status: "sent", media: null, reactTo: null, unsend: null, typing: false, scheduledFor: null, sentAt: "2026-11-02T00:00:00Z", attempts: 1, error: null, createdAt: "2026-11-02T00:00:00Z" }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net"), conn("home", "447700900111:3@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [sent] })
  assert.match(html, /\+65 9136 3557/)
  assert.match(html, /\+44 7700 900111/)
  assert.match(html, /class="acard add"/)
  assert.match(html, /class="soon-x" tabindex="0" aria-label="iMessage, coming soon">.*?<b>iMessage<\/b>Coming soon/s)
  assert.doesNotMatch(html, /aria-label="WhatsApp, coming soon"/)
  assert.match(html, /action="\/app\/connect"/)
  assert.match(html, /<td class="fr">\+44 7700 900111<\/td>\s*<td class="to">\+44 7700 900999<\/td>/)
  assert.match(html, /data-live="\/app\/activity\/feed\?compact=1"/)
  const solo = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net")], agents: [agent], mcpUrl: "https://x/mcp", recent: [{ ...sent, connectionId: "work" }] })
  assert.doesNotMatch(solo, /class="fr"/)

  // A link that was started and never scanned isn't an account: no card of its own, and "Connect" finishes it instead.
  for (const status of ["linking", "closed"] as const) {
    const started = { ...conn("new", ""), handle: null, status, linkedAt: null }
    const withAccounts = dashboardPage({ user, connections: [conn("work", "6591363557:7@s.whatsapp.net"), started], agents: [agent], mcpUrl: "https://x/mcp" })
    assert.doesNotMatch(withAccounts, /Waiting for the QR scan|waiting for scan/i)
    assert.match(withAccounts, /You started linking a number.*href="\/link\/new">Finish linking/s)
    const onlyThat = dashboardPage({ user, connections: [started], agents: [], mcpUrl: "https://x/mcp" })
    assert.match(onlyThat, /class="conn ready">.*href="\/link\/new">Finish linking/s)
    assert.doesNotMatch(onlyThat, /class="acard"|class="done-tag"/)
  }
})

test("a number's card shows its profile picture with a small WhatsApp badge, else the WhatsApp logo", () => {
  const conn = (avatar: string | null): Connection => ({
    id: "work", accountId: "a", channel: "whatsapp", status: "connected", handle: "6591363557:7@s.whatsapp.net", displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: null }, timezone: "Asia/Singapore", country: "SG", haltedReason: null, pausedUntil: null, dailyLimit: 100, activeHours: false, gapSeconds: null, readReceipts: true, typing: true, avatar,
  })
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const page = (avatar: string | null) => dashboardPage({ user, connections: [conn(avatar)], agents: [], mcpUrl: "https://x/mcp", recent: [] })
  const withDp = page("data:image/jpeg;base64,AAAA")
  assert.match(withDp, /<span class="pdp"[^>]*><img src="data:image\/jpeg;base64,AAAA"[^>]*><span class="badge"><svg class="cm"/)
  const without = page(null)
  assert.doesNotMatch(without, /class="pdp"/)
  assert.match(without, /<div class="ah"><span class="ct"><svg class="cm"/)
})

test("an account page shows its chats with the daily limit and disconnect on top", () => {
  const conn: Connection = {
    id: "work", accountId: "a", channel: "whatsapp", status: "connected", handle: "6591363557:7@s.whatsapp.net", displayName: null, createdAt: "2026-11-01T00:00:00Z", linkedAt: "2026-11-01T00:00:00Z",
    chatsChosen: true, history: { startedAt: null, progress: null, doneAt: "2026-11-01T00:01:00Z" }, timezone: "America/Los_Angeles", country: "US", haltedReason: null, pausedUntil: null, dailyLimit: 100, activeHours: false, gapSeconds: null, readReceipts: true, typing: true, avatar: null,
  }
  const user = { name: "R", email: "r@parley.test", image: null, signedInWith: "local", createdAt: "2026-11-01T00:00:00Z" }
  const html = chatsPage({ user, connection: conn, chats: [], agentCount: 1, saved: false, today: { sentToday: 7, dailyLimit: 100 }, queued: 2, webhooks: { webhooks: [], deliveries: [] } })
  assert.match(html, /\+65 9136 3557/)
  // Ignoring asks first and says what goes; a visible chat Parley can't load history for says so.
  const row = (c: Partial<ChatRow>): ChatRow => ({ id: "g@g.us", kind: "group", name: "Family 2", synced: true, lastMessageAt: "2026-11-05T07:09:07Z", lastCallAt: null, lastCallKind: null, ...c })
  const listed = chatsPage({ user, connection: conn, chats: [row({ canLoadHistory: false }), row({ id: "h@g.us", name: "Hikes", canLoadHistory: true }), row({ id: "o@g.us", name: "Old", synced: false, canLoadHistory: false })], agentCount: 1, saved: false, today: null, queued: 0, webhooks: { webhooks: [], deliveries: [] } })
  assert.match(listed, /if\(ignored&&!confirm\("Ignore \{name\}\?/)
  assert.match(listed, /load_history/)
  assert.equal(listed.match(/· no history yet<\/p>/g)?.length, 1)
  assert.match(listed, /data-id="g@g.us"[^>]*data-hist="0"[\s\S]*?class="s warn" title="Parley has no message from this chat/)
  assert.doesNotMatch(listed, /Hikes<\/p><p class="s warn"/)
  assert.match(html, /name="daily_limit"[^>]*value="100"/)
  assert.match(html, /name="active_hours" value="on" onchange/)
  assert.match(html, /name="hours_form" value="1"/)
  assert.match(html, /name="gap_seconds"[^>]*value=""[^>]*placeholder="30–150"/)
  assert.match(html, /7<span class="faint"> \/ 100 sent today/)
  assert.match(html, /action="\/app\/connections\/work\/disconnect"/)
  assert.doesNotMatch(html, /<input(?![^>]*type="hidden")[^>]*name="(timezone|country)"/)
  assert.doesNotMatch(html, /New conversations/)
  assert.doesNotMatch(html, /class="pdp"/)
  const withDp = chatsPage({ user, connection: { ...conn, avatar: "data:image/jpeg;base64,AAAA" }, chats: [], agentCount: 1, saved: false, today: { sentToday: 7, dailyLimit: 100 }, queued: 2, webhooks: { webhooks: [], deliveries: [] } })
  assert.match(withDp, /<h1><span class="pdp"[^>]*><img src="data:image\/jpeg;base64,AAAA"/)
})
