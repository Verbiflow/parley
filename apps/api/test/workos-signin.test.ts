import assert from "node:assert/strict"
import { test } from "node:test"
import { hashSecret, newSecret, store } from "@parley/auth"
import { testServer } from "./support.ts"

// With WorkOS configured there is no email-only login anywhere: agents authorize through the person's real session.
const { base, sql, ctx } = await testServer(undefined, { WORKOS_CLIENT_ID: "client_test123", WORKOS_API_KEY: "sk_test_abc123" })
const REDIRECT = "http://127.0.0.1:9999/callback"

/** A signed-in browser for an account, as if it had come back from WorkOS. */
async function signedIn(email: string): Promise<{ cookie: string; accountId: string }> {
  const account = await store.upsertAccount(sql, { subject: `workos:${email}`, email, name: email, signedInWith: "google" })
  const token = newSecret("parley_bs")
  await store.startBrowserSession(sql, { userId: account.id, tokenHash: await hashSecret(token), method: "google", expiresAt: new Date(Date.now() + 3600_000), userAgent: null })
  return { cookie: `parley_session=${token}`, accountId: account.id }
}

async function authorizeUrl(): Promise<{ url: string; verifier: string; clientId: string }> {
  const reg = await (await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT] }) })).json() as { client_id: string }
  const verifier = newSecret("parley_dvc")
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: await hashSecret(verifier), code_challenge_method: "S256", state: "st" })
  return { url: `/oauth/authorize?${q}`, verifier, clientId: reg.client_id }
}

test("no dev login: the landing page has no email form and /auth/dev is gone", async () => {
  const html = await (await fetch(`${base}/`)).text()
  assert.match(html, /Continue with Google/)
  assert.doesNotMatch(html, /dev login|name="email"/)
  assert.equal((await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "x@y.z" }) })).status, 404)
})

test("agent sign-in: signed out → WorkOS, and back to the consent step afterwards", async () => {
  const { url } = await authorizeUrl()
  const res = await fetch(`${base}${url}`, { redirect: "manual" })
  assert.equal(res.headers.get("location"), "/auth/start")
  assert.match(res.headers.get("set-cookie") ?? "", /parley_next=/)
  // An email can't be posted to get a code.
  const form = Object.fromEntries(new URL(url, base).searchParams)
  const forged = await fetch(`${base}/oauth/authorize`, { method: "POST", redirect: "manual", body: new URLSearchParams({ ...form, email: "victim@parley.test", decision: "allow" }) })
  assert.equal(forged.status, 401)
})

test("agent sign-in: signed in → Allow issues a code for that account; Cancel denies", async () => {
  const { cookie, accountId } = await signedIn("hana@parley.test")
  const { url, verifier, clientId } = await authorizeUrl()
  const page = await (await fetch(`${base}${url}`, { headers: { cookie } })).text()
  assert.match(page, /Allow Claude Code to use Parley\?/)
  assert.match(page, /hana@parley\.test/)
  const form = Object.fromEntries(new URL(url, base).searchParams)

  const denied = await fetch(`${base}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { cookie }, body: new URLSearchParams({ ...form, decision: "deny" }) })
  assert.equal(new URL(denied.headers.get("location")!).searchParams.get("error"), "access_denied")

  const allowed = await fetch(`${base}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { cookie }, body: new URLSearchParams({ ...form, decision: "allow" }) })
  const back = new URL(allowed.headers.get("location")!)
  assert.equal(back.searchParams.get("state"), "st")
  const tokens = await (await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }) })).json() as { access_token: string }
  const principal = await (await ctx.accessTokenKeys).verify(tokens.access_token)
  assert.equal(principal.userId, accountId)
})
