import { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { store } from "@parley/auth"
import type { AppContext } from "../context.ts"
import { currentUserId, startSession, clearSession } from "./session.ts"
import { workosClient, redirectUri } from "./workos.ts"
import { landingPage, dashboardPage } from "./pages.ts"

/**
 * The human-facing web app: sign in (WorkOS AuthKit, or a local dev login), then a dashboard to connect channels.
 * This is separate from the agent's OAuth-over-MCP flow under /oauth — this is a person in a browser.
 */
export function webRoutes(ctx: AppContext): Hono {
  const app = new Hono()
  const workos = workosClient(ctx.config)

  app.get("/", async (c) => {
    if (await currentUserId(c, ctx)) return c.redirect("/app")
    return c.html(landingPage({ workos: Boolean(workos), dev: ctx.config.localProvider }))
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
    const result = await workos.userManagement.authenticateWithCode({ code, clientId: ctx.config.workos!.clientId })
    const user = result.user
    const method: store.SignInMethod = result.authenticationMethod === "GitHubOAuth" ? "github" : result.authenticationMethod === "GoogleOAuth" ? "google" : "local"
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    const account = await store.upsertAccount(ctx.sql, { subject: `workos:${user.id}`, email: user.email, name, image: user.profilePictureUrl ?? null, signedInWith: method })
    await startSession(c, ctx, account.id, method)
    return c.redirect("/app")
  })

  // Local-only dev sign-in, so the dashboard is usable before WorkOS is wired.
  app.post("/auth/dev", async (c) => {
    if (!ctx.config.localProvider) return c.text("Not available.", 404)
    const email = String((await c.req.formData()).get("email") ?? "").trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return c.text("A valid email is required.", 400)
    const account = await store.upsertAccount(ctx.sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })
    await startSession(c, ctx, account.id, "local")
    return c.redirect("/app")
  })

  app.get("/app", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    return c.html(dashboardPage({ connections: await ctx.sessions.list(userId) }))
  })

  app.post("/app/connect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const started = await ctx.sessions.connect(userId, "whatsapp")
    return c.redirect(`/link/${started.connectionId}`)
  })

  app.post("/auth/signout", (c) => {
    clearSession(c)
    return c.redirect("/")
  })

  return app
}
