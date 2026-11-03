import { Hono, type Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { store } from "@parley/auth"
import type { AppContext } from "../context.ts"
import { currentSession, currentUserId, startSession, clearSession, rememberNext as rememberNextPath, takeNext } from "./session.ts"
import { agentSessions, endAgentSession } from "../oauth/store.ts"
import { workosClient, redirectUri } from "./workos.ts"
import { landingPage, dashboardPage, agentsPage, settingsPage, chatsPage } from "./pages.ts"
import { ConnectError } from "../sessions/actor.ts"

/**
 * The human-facing web app: sign in (WorkOS AuthKit, or a local dev login), then a dashboard to connect channels.
 * This is separate from the agent's OAuth-over-MCP flow under /oauth — this is a person in a browser.
 */
export function webRoutes(ctx: AppContext): Hono {
  const app = new Hono()
  const workos = workosClient(ctx.config)

  // A signed-out visitor to an /app page (e.g. "Choose chats" from the link page) comes back to it after signing in.
  const rememberNext = (c: Context) => {
    rememberNextPath(c, ctx, new URL(c.req.url).pathname)
    return c.redirect("/")
  }
  const landing = (c: Context) => c.redirect(takeNext(c))
  // The email-only dev login exists only when there's no real sign-in configured (local dev without WorkOS, tests).
  const devLogin = ctx.config.localProvider && !workos

  app.get("/", async (c) => {
    if (await currentUserId(c, ctx)) return landing(c)
    return c.html(landingPage({ workos: Boolean(workos), dev: devLogin }))
  })

  app.get("/auth/start", (c) => {
    if (!workos) return c.text("WorkOS isn't configured. Set WORKOS_CLIENT_ID and WORKOS_API_KEY.", 501)
    const state = crypto.randomUUID()
    setCookie(c, "parley_oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600, secure: (ctx.config.publicUrl ?? "").startsWith("https:") })
    const url = workos.userManagement.getAuthorizationUrl({ provider: "authkit", redirectUri: redirectUri(ctx.config), clientId: ctx.config.workos!.clientId, state })
    return c.redirect(url)
  })

  app.get("/auth/callback", async (c) => {
    if (!workos) return c.text("WorkOS isn't configured.", 501)
    const code = c.req.query("code")
    const state = c.req.query("state")
    if (!code || !state || state !== getCookie(c, "parley_oauth_state")) return c.text("Sign-in failed (bad state). Try again.", 400)
    let result: Awaited<ReturnType<typeof workos.userManagement.authenticateWithCode>>
    try {
      result = await workos.userManagement.authenticateWithCode({ code, clientId: ctx.config.workos!.clientId })
    } catch (e) {
      console.error(JSON.stringify({ msg: "workos sign-in failed", error: e instanceof Error ? e.message : String(e) }))
      return c.html(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="font-family:system-ui;max-width:28rem;margin:5rem auto;text-align:center"><h1 style="font-size:20px">Sign-in didn't go through</h1><p style="color:#666">WorkOS rejected the sign-in. Check that WORKOS_CLIENT_ID and WORKOS_API_KEY are from the same WorkOS environment.</p><p><a href="/auth/start">Try again</a></p></body>`, 502)
    }
    const user = result.user
    const method: store.SignInMethod = result.authenticationMethod === "GitHubOAuth" ? "github" : result.authenticationMethod === "GoogleOAuth" ? "google" : "local"
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    const account = await store.upsertAccount(ctx.sql, { subject: `workos:${user.id}`, email: user.email, name, image: user.profilePictureUrl ?? null, signedInWith: method })
    await startSession(c, ctx, account.id, method)
    return landing(c)
  })

  // Local-only dev sign-in, so the dashboard is usable before WorkOS is wired.
  app.post("/auth/dev", async (c) => {
    if (!devLogin) return c.text("Not available.", 404)
    const email = String((await c.req.formData()).get("email") ?? "").trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return c.text("A valid email is required.", 400)
    const account = await store.upsertAccount(ctx.sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })
    await startSession(c, ctx, account.id, "local")
    return landing(c)
  })

  /** Resolve the signed-in account for an /app page, or undefined (the caller redirects to sign-in). */
  async function viewer(c: Context): Promise<{ profile: store.Profile; sessionId: string } | undefined> {
    const session = await currentSession(c, ctx)
    if (!session) return undefined
    const profile = await store.accountById(ctx.sql, session.userId)
    return profile && { profile, sessionId: session.id }
  }

  const mcpUrl = (c: Context) => `${ctx.config.publicUrl ?? new URL(c.req.url).origin}/mcp`

  app.get("/app", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    const [connections, agents] = await Promise.all([ctx.sessions.list(v.profile.id), agentSessions(ctx.sql, v.profile.id)])
    const syncedCounts = new Map<string, number>()
    for (const conn of connections) {
      if (conn.status === "connected" && conn.chatsChosen) syncedCounts.set(conn.id, (await ctx.sessions.chats(v.profile.id, conn.id, { syncedOnly: true })).length)
    }
    return c.html(dashboardPage({ user: v.profile, connections, agents, mcpUrl: mcpUrl(c), syncedCounts }))
  })

  app.post("/app/connect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const started = await ctx.sessions.connect(userId, "whatsapp")
    return c.redirect(`/link/${started.connectionId}`)
  })

  app.post("/app/connections/:id/disconnect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await ctx.sessions.logout(userId, c.req.param("id")).catch(() => {})
    return c.redirect("/app")
  })

  // Choose which chats on a connection are synced (visible to agents). Signed-in only: the link URL an agent holds
  // must not let it widen its own access.
  app.get("/app/connections/:id/chats", async (c) => {
    const v = await viewer(c)
    if (!v) return rememberNext(c)
    const id = c.req.param("id")
    const connection = (await ctx.sessions.list(v.profile.id)).find((x) => x.id === id)
    if (!connection) return c.text("Unknown connection.", 404)
    const [chats, agents] = await Promise.all([ctx.sessions.chats(v.profile.id, id), agentSessions(ctx.sql, v.profile.id)])
    return c.html(chatsPage({ user: v.profile, connection, chats, agentCount: agents.length, saved: c.req.query("saved") === "1" }))
  })

  app.post("/app/connections/:id/chats", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const id = c.req.param("id")
    const chosen = (await c.req.formData()).getAll("chat").map(String).filter(Boolean)
    try {
      await ctx.sessions.chooseChats(userId, id, chosen)
    } catch (e) {
      if (e instanceof ConnectError) return c.text("Unknown connection.", 404)
      throw e
    }
    return c.redirect(`/app/connections/${id}/chats?saved=1`)
  })

  app.get("/app/agents", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    return c.html(agentsPage({ user: v.profile, agents: await agentSessions(ctx.sql, v.profile.id), mcpUrl: mcpUrl(c) }))
  })

  app.post("/app/agents/:id/disconnect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await endAgentSession(ctx.sql, userId, c.req.param("id"))
    return c.redirect("/app/agents")
  })

  app.get("/app/settings", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    return c.html(settingsPage({ user: v.profile, sessions: await store.browserSessions(ctx.sql, v.profile.id), currentSessionId: v.sessionId }))
  })

  app.post("/app/settings/sessions/:id/end", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    if (c.req.param("id") === v.sessionId) {
      await clearSession(c, ctx)
      return c.redirect("/")
    }
    await store.endBrowserSession(ctx.sql, v.profile.id, c.req.param("id"))
    return c.redirect("/app/settings")
  })

  app.post("/app/settings/sessions/end-others", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    await store.endOtherBrowserSessions(ctx.sql, v.profile.id, v.sessionId)
    return c.redirect("/app/settings")
  })

  app.post("/auth/signout", async (c) => {
    await clearSession(c, ctx)
    return c.redirect("/")
  })

  return app
}
