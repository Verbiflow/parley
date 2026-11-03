import { Hono } from "hono"
import { z } from "zod"
import { base64url, hashSecret, newSecret, pkceMatches, store } from "@parley/auth"
import type { Context } from "hono"
import type { AppContext } from "../context.ts"
import { currentUserId, rememberNext } from "../web/session.ts"
import { consentPage } from "../web/pages.ts"
import { createAuthCode, createRefreshToken, claimAuthCode, getClient, registerClient, rotateRefreshToken } from "./store.ts"

/**
 * Parley's OAuth 2.1 authorization server for agents connecting over MCP (MCP authorization = OAuth 2.1 + dynamic
 * client registration + PKCE). Public clients only: no client secret, PKCE (S256) required. The access token is the
 * standard EdDSA connection token; refresh tokens rotate on use.
 *
 * Sign-in: with WorkOS configured, `/authorize` uses the person's dashboard sign-in (sending them through WorkOS if
 * they aren't signed in) and asks them to allow the agent. Without WorkOS (local dev, tests), a tiny email form stands
 * in for the IdP so the flow is exercisable end to end without external services.
 */

const AUTH_CODE_SECONDS = 600
const REFRESH_TOKEN_SECONDS = 60 * 60 * 24 * 30

const RegisterSchema = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(20),
  grant_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
})

function baseUrl(c: { req: { url: string } }, ctx: AppContext): string {
  return ctx.config.publicUrl ?? new URL(c.req.url).origin
}

export function oauthRoutes(ctx: AppContext): Hono {
  const app = new Hono()

  // --- Discovery -------------------------------------------------------------
  app.get("/.well-known/oauth-protected-resource", (c) => {
    const base = baseUrl(c, ctx)
    return c.json({ resource: base, authorization_servers: [base] })
  })

  app.get("/.well-known/oauth-authorization-server", (c) => {
    const base = baseUrl(c, ctx)
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    })
  })

  // --- Dynamic client registration (RFC 7591) --------------------------------
  app.post("/oauth/register", async (c) => {
    const parsed = RegisterSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: "invalid_client_metadata" }, 400)
    const clientId = `parley_client_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`
    const client = await registerClient(ctx.sql, { clientId, clientName: parsed.data.client_name, redirectUris: parsed.data.redirect_uris })
    return c.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      },
      201
    )
  })

  // --- Authorization endpoint ------------------------------------------------
  const realSignIn = Boolean(ctx.config.workos)
  const devSignIn = ctx.config.localProvider && !realSignIn

  /** Issue a one-time code for `userId` and send the agent back to its redirect URI. */
  async function approve(c: Context, form: Record<string, string>, userId: string): Promise<Response> {
    const code = newSecret("parley_sc")
    await createAuthCode(ctx.sql, {
      codeHash: await hashSecret(code),
      clientId: form.client_id!,
      userId,
      redirectUri: form.redirect_uri!,
      codeChallenge: form.code_challenge!,
      scope: form.scope ?? null,
      sessionId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + AUTH_CODE_SECONDS * 1000),
    })
    const to = new URL(form.redirect_uri!)
    to.searchParams.set("code", code)
    if (form.state) to.searchParams.set("state", form.state)
    return c.redirect(to.toString(), 302)
  }

  // GET: signed in → "Allow <agent>?"; signed out → sign in first, then come back here. (Dev: the email form.)
  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query()
    const err = await validateAuthorize(ctx, q)
    if (err) return c.json(err, 400)
    if (realSignIn) {
      const userId = await currentUserId(c, ctx)
      if (!userId) {
        const url = new URL(c.req.url)
        rememberNext(c, ctx, url.pathname + url.search)
        return c.redirect("/auth/start")
      }
      const [client, account] = await Promise.all([getClient(ctx.sql, q.client_id!), store.accountById(ctx.sql, userId)])
      return c.html(consentPage({ clientName: client?.clientName ?? null, redirectUri: q.redirect_uri!, email: account?.email ?? "", fields: q }))
    }
    if (!devSignIn) return c.text("Sign-in isn't configured. Set WORKOS_CLIENT_ID and WORKOS_API_KEY.", 501)
    return c.html(signInForm(q))
  })

  app.post("/oauth/authorize", async (c) => {
    const form = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>
    const err = await validateAuthorize(ctx, form)
    if (err) return c.json(err, 400)
    if (realSignIn) {
      // The session cookie is SameSite=Lax, so a cross-site form can't post here as the signed-in person.
      const userId = await currentUserId(c, ctx)
      if (!userId) return c.text("Sign in first.", 401)
      if (form.decision !== "allow") {
        const to = new URL(form.redirect_uri!)
        to.searchParams.set("error", "access_denied")
        if (form.state) to.searchParams.set("state", form.state)
        return c.redirect(to.toString(), 302)
      }
      return approve(c, form, userId)
    }
    if (!devSignIn) return c.text("Sign-in isn't configured.", 501)
    const email = (form.email ?? "").trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return c.json({ error: "invalid_request", error_description: "a valid email is required" }, 400)
    const account = await store.upsertAccount(ctx.sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })
    return approve(c, form, account.id)
  })

  // --- Token endpoint --------------------------------------------------------
  app.post("/oauth/token", async (c) => {
    const form = Object.fromEntries((await c.req.formData().catch(() => new FormData())).entries()) as Record<string, string>
    const grant = form.grant_type

    if (grant === "authorization_code") {
      if (!form.code || !form.code_verifier || !form.redirect_uri || !form.client_id) return tokenError(c, "invalid_request")
      const claimed = await claimAuthCode(ctx.sql, await hashSecret(form.code))
      if (!claimed) return tokenError(c, "invalid_grant")
      if (claimed.clientId !== form.client_id || claimed.redirectUri !== form.redirect_uri) return tokenError(c, "invalid_grant")
      if (!(await pkceMatches(form.code_verifier, claimed.codeChallenge))) return tokenError(c, "invalid_grant")
      return c.json(await issueTokens(ctx, claimed))
    }

    if (grant === "refresh_token") {
      if (!form.refresh_token || !form.client_id) return tokenError(c, "invalid_request")
      const rotated = await rotateRefreshToken(ctx.sql, await hashSecret(form.refresh_token))
      if (!rotated || rotated.clientId !== form.client_id) return tokenError(c, "invalid_grant")
      return c.json(await issueTokens(ctx, rotated))
    }

    return tokenError(c, "unsupported_grant_type")
  })

  return app
}

async function validateAuthorize(ctx: AppContext, q: Record<string, string>): Promise<{ error: string; error_description?: string } | undefined> {
  if (q.response_type !== "code") return { error: "unsupported_response_type" }
  if (q.code_challenge_method !== "S256" || !q.code_challenge || q.code_challenge.length !== 43) return { error: "invalid_request", error_description: "PKCE S256 is required" }
  if (!q.client_id) return { error: "invalid_request", error_description: "client_id is required" }
  const client = await getClient(ctx.sql, q.client_id)
  if (!client) return { error: "invalid_client" }
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) return { error: "invalid_request", error_description: "redirect_uri not registered" }
  return undefined
}

async function issueTokens(ctx: AppContext, grant: { userId: string; clientId: string; sessionId: string; scope: string | null }): Promise<Record<string, unknown>> {
  const keys = await ctx.accessTokenKeys
  const entitlements = await store.entitlements(ctx.sql, grant.userId)
  const { token, expiresAt } = await keys.sign({ userId: grant.userId, deviceId: grant.sessionId, deviceKind: "runtime", entitlements })
  const refresh = newSecret("parley_sc")
  await createRefreshToken(ctx.sql, {
    tokenHash: await hashSecret(refresh),
    clientId: grant.clientId,
    userId: grant.userId,
    sessionId: grant.sessionId,
    scope: grant.scope,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
  })
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
    refresh_token: refresh,
    scope: grant.scope ?? "mcp",
  }
}

function tokenError(c: { json: (o: unknown, s?: 400) => Response }, error: string): Response {
  return c.json({ error }, 400)
}

function signInForm(q: Record<string, string>): string {
  const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope"]
    .filter((k) => q[k] != null)
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(q[k]!)}">`)
    .join("")
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in to Parley</title></head>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto">
<h1>Connect to Parley</h1>
<p>Dev sign-in. Enter an email to authorize this agent.</p>
<form method="post" action="/oauth/authorize">${hidden}
<input name="email" type="email" placeholder="you@example.com" required style="width:100%;padding:.5rem;margin:.5rem 0">
<button type="submit" style="padding:.5rem 1rem">Authorize</button>
</form></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)
}
