import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa")
const { ctx, base, sql } = await testServer([fake.channel])

async function browser(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })
  assert.equal(res.status, 302)
  return res.headers.get("set-cookie")!.split(";")[0]!
}

test("the activity log lists every send with the agent that asked, filters and searches them, and feeds the live view", async () => {
  const email = "activity@parley.test"
  const token = await agentToken(base, email, "Claude")
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: "A", signedInWith: "local" })
  const started = await callTool(base, token, "connect", { channel: "fake-wa", timezone: "Europe/London", country: "gb" })
  const connectionId = started.result.connection_id as string
  await waitUntil(() => ctx.sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => ctx.sessions.status(account.id, connectionId), (s) => s.status === "connected")

  // Far-off slots keep these queued whatever the time of day.
  const later = { connection_id: connectionId, not_before: "2099-01-01T12:00:00Z" }
  await callTool(base, token, "send_message", { ...later, to: "+447700900123", text: "Dinner at 8?" })
  await callTool(base, token, "send_message", { ...later, to: "+447700900456", text: "Contract attached" })
  const third = await callTool(base, token, "send_message", { ...later, to: "+447700900789", text: "Never mind" })
  await callTool(base, token, "cancel_message", { message_id: third.result.id })

  const cookie = await browser(email)
  const page = await (await fetch(`${base}/app/activity`, { headers: { cookie } })).text()
  assert.match(page, /Dinner at 8\?/)
  assert.match(page, /Contract attached/)
  assert.match(page, /title="Claude"/)
  assert.match(page, /data-count="all">3</)
  assert.match(page, /data-count="queued">2</)
  assert.match(page, /data-count="canceled">1</)
  assert.match(page, /data-live="\/app\/activity\/feed"/)

  const canceled = await (await fetch(`${base}/app/activity?status=canceled`, { headers: { cookie } })).text()
  assert.match(canceled, /Never mind/)
  assert.doesNotMatch(canceled, /Dinner at 8\?/)

  const byNumber = await (await fetch(`${base}/app/activity?q=${encodeURIComponent("+44 7700 900456")}`, { headers: { cookie } })).text()
  assert.match(byNumber, /Contract attached/)
  assert.doesNotMatch(byNumber, /Dinner at 8\?/)
  const byText = await (await fetch(`${base}/app/activity?q=dinner`, { headers: { cookie } })).text()
  assert.match(byText, /Dinner at 8\?/)
  assert.doesNotMatch(byText, /Contract attached/)
  assert.match(await (await fetch(`${base}/app/activity?q=100%25_off`, { headers: { cookie } })).text(), /Nothing matches/)

  const feed = await (await fetch(`${base}/app/activity/feed?status=queued`, { headers: { cookie } })).json() as { body: string; counts: Record<string, number>; total: number }
  assert.equal(feed.total, 2)
  assert.equal(feed.counts.all, 3)
  assert.match(feed.body, /data-s="scheduled"/)
  assert.doesNotMatch(feed.body, /Never mind/)
  assert.equal((await fetch(`${base}/app/activity/feed`)).status, 401)

  // Someone else's log is their own.
  const other = await browser("activity-other@parley.test")
  assert.doesNotMatch(await (await fetch(`${base}/app/activity`, { headers: { cookie: other } })).text(), /Dinner at 8\?/)
  assert.equal((await fetch(`${base}/app/outbox?view=recent`, { headers: { cookie }, redirect: "manual" })).headers.get("location"), "/app/activity")
})
