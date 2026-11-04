import assert from "node:assert/strict"
import { test } from "node:test"
import { hashSecret, newSecret } from "@parley/auth"
import { testServer } from "./support.ts"

const { base } = await testServer()
const REDIRECT = "http://127.0.0.1:9999/callback"

/** Sign a browser in via the dev login; returns its session cookie. */
async function browser(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })
  assert.equal(res.status, 302)
  return res.headers.get("set-cookie")!.split(";")[0]!
}

/** Authorize an MCP client for `email`; returns its access token. */
async function agent(email: string, name: string): Promise<string> {
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }),
  })).json() as { client_id: string }
  const verifier = newSecret("parley_dvc")
  const authorize = await fetch(`${base}/oauth/authorize`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: await hashSecret(verifier), code_challenge_method: "S256", email }),
  })
  const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!
  const tokens = await (await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }),
  })).json() as { access_token: string }
  return tokens.access_token
}

const mcpPing = (token: string) => fetch(`${base}/mcp`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
})

test("dashboard pages show the signed-in account and escape it", async () => {
  const cookie = await browser("dana@parley.test")
  for (const path of ["/app", "/app/agents", "/app/settings"]) {
    const html = await (await fetch(`${base}${path}`, { headers: { cookie } })).text()
    assert.match(html, /dana@parley\.test/, path)
    assert.match(html, /class="top"/, path)
  }
  const settings = await (await fetch(`${base}/app/settings`, { headers: { cookie } })).text()
  assert.match(settings, /This browser/)
})

test("disconnecting an agent lists it, then cuts off its live access token immediately", async () => {
  const cookie = await browser("erin@parley.test")
  const token = await agent("erin@parley.test", "Erin's <Agent>")
  assert.equal((await mcpPing(token)).status, 200)

  const page = await (await fetch(`${base}/app/agents`, { headers: { cookie } })).text()
  assert.match(page, /Erin&#39;s &lt;Agent&gt;/)
  const sessionId = page.match(/\/app\/agents\/([0-9a-f-]{36})\/disconnect/)![1]!

  // Another account can't disconnect it.
  const other = await browser("mallory@parley.test")
  await fetch(`${base}/app/agents/${sessionId}/disconnect`, { method: "POST", redirect: "manual", headers: { cookie: other } })
  assert.equal((await mcpPing(token)).status, 200)

  await fetch(`${base}/app/agents/${sessionId}/disconnect`, { method: "POST", redirect: "manual", headers: { cookie } })
  assert.equal((await mcpPing(token)).status, 401)
  assert.doesNotMatch(await (await fetch(`${base}/app/agents`, { headers: { cookie } })).text(), /Erin&#39;s/)
})

test("sign out ends the server-side session, not just the cookie", async () => {
  const cookie = await browser("fay@parley.test")
  await fetch(`${base}/auth/signout`, { method: "POST", redirect: "manual", headers: { cookie } })
  const res = await fetch(`${base}/app`, { redirect: "manual", headers: { cookie } })
  assert.equal(res.status, 302)
})

test("an agent's tool calls show up as live activity, and the dashboard shows how to add Parley", async () => {
  const cookie = await browser("gus@parley.test")
  let dash = await (await fetch(`${base}/app`, { headers: { cookie } })).text()
  assert.match(dash, /Connect your agent/)
  assert.doesNotMatch(dash, /Ask it something/)
  assert.match(dash, /claude mcp add --transport http parley http:\/\/127\.0\.0\.1:\d+\/mcp/)

  const token = await agent("gus@parley.test", "Gus's Claude")
  let agents = await (await fetch(`${base}/app/agents`, { headers: { cookie } })).text()
  assert.match(agents, /hasn&#39;t used Parley yet|hasn't used Parley yet/)

  await mcpPing(token)
  const call = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_inbox", arguments: {} } }),
  })
  assert.equal(call.status, 200)
  await new Promise((r) => setTimeout(r, 100)) // activity is recorded best-effort, after the response
  agents = await (await fetch(`${base}/app/agents`, { headers: { cookie } })).text()
  assert.match(agents, /Using Parley right now · last read your inbox just now · 1 tool call/)
  assert.match(agents, /class="live"/)

  dash = await (await fetch(`${base}/app`, { headers: { cookie } })).text()
  assert.match(dash, /Gus&#39;s Claude<\/b> is using Parley right now/)
})
