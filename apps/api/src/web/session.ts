import type { Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { hashSecret, newSecret, store, type IdentityConfig } from "@parley/auth"
import type { AppContext } from "../context.ts"

/** The browser session cookie for the web dashboard. Only the token's SHA-256 is stored (identity.browser_session). */
const COOKIE = "parley_session"

export async function startSession(c: Context, ctx: AppContext, userId: string, method: store.SignInMethod): Promise<void> {
  const token = newSecret("parley_bs")
  await store.startBrowserSession(ctx.sql, {
    userId,
    tokenHash: await hashSecret(token),
    method,
    expiresAt: new Date(Date.now() + ctx.config.browserSessionSeconds * 1000),
    userAgent: c.req.header("user-agent") ?? null,
  })
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ctx.config.browserSessionSeconds,
    secure: isHttps(ctx.config),
  })
}

export async function currentUserId(c: Context, ctx: AppContext): Promise<string | undefined> {
  const token = getCookie(c, COOKIE)
  if (!token) return undefined
  const session = await store.sessionByToken(ctx.sql, await hashSecret(token))
  return session?.userId
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" })
}

function isHttps(config: IdentityConfig): boolean {
  return (config.publicUrl ?? "").startsWith("https:")
}
