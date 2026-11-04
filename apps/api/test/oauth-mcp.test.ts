import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { hashSecret, newSecret } from "@parley/auth"
import { testServer } from "./support.ts"

const { base } = await testServer()

const REDIRECT = "http://127.0.0.1:9999/callback"

/** Register a public client, run the authorization-code + PKCE flow via the dev sign-in, and return the token set. */
async function signIn(email: string): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test Agent", redirect_uris: [REDIRECT] }),
  })).json() as { client_id: string }

  const verifier = newSecret("parley_dvc")
  const challenge = await hashSecret(verifier)

  const authorize = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: "S256", state: "xyz", email,
    }),
  })
  assert.equal(authorize.status, 302)
  const location = new URL(authorize.headers.get("location")!)
  assert.equal(location.searchParams.get("state"), "xyz")
  const code = location.searchParams.get("code")!
  assert.ok(code)

  const tokenRes = await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }),
  })
  assert.equal(tokenRes.status, 200)
  const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; token_type: string }
  assert.equal(tokens.token_type, "Bearer")
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, clientId: reg.client_id }
}

test("discovery metadata advertises the AS and protected resource", async () => {
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>
  assert.equal(as.token_endpoint, `${base}/oauth/token`)
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"])
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json() as { authorization_servers: string[] }
  assert.deepEqual(pr.authorization_servers, [base])
})

test("authorization-code + PKCE issues a bearer token; refresh rotates it", async () => {
  const { refreshToken, clientId } = await signIn("alice@parley.test")
  const refreshed = await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  })
  assert.equal(refreshed.status, 200)
  const next = await refreshed.json() as { access_token: string; refresh_token: string }
  assert.ok(next.access_token)
  // The old refresh token is single-use: a second refresh with it fails.
  const reused = await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  })
  assert.equal(reused.status, 400)
})

test("the token fails PKCE when the verifier is wrong", async () => {
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT] }),
  })).json() as { client_id: string }
  const challenge = await hashSecret(newSecret("parley_dvc"))
  const authorize = await fetch(`${base}/oauth/authorize`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", email: "bob@parley.test" }),
  })
  const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!
  const bad = await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: "the-wrong-verifier" }),
  })
  assert.equal(bad.status, 400)
})

test("MCP: an authenticated client lists tools and calls list_connections (empty)", async () => {
  const { accessToken } = await signIn("carol@parley.test")
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const client = new Client({ name: "test-client", version: "0.0.0" })
  await client.connect(transport)
  try {
    const tools = await client.listTools()
    assert.ok(tools.tools.some((t) => t.name === "list_connections"))
    const result = await client.callTool({ name: "list_connections", arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    assert.deepEqual(JSON.parse(text).connections, [])
    assert.match(JSON.parse(text).note, /call connect/i)
  } finally {
    await transport.close()
  }
})

test("MCP: a request with no bearer token is refused with WWW-Authenticate", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
  })
  assert.equal(res.status, 401)
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata=/)
})
