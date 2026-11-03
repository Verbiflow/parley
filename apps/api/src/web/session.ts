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

/** The signed-in browser session (account + session id), or undefined. */
export async function currentSession(c: Context, ctx: AppContext): Promise<{ userId: string; id: string } | undefined> {
  const token = getCookie(c, COOKIE)
  if (!token) return undefined
  return store.sessionByToken(ctx.sql, await hashSecret(token))
}

export async function currentUserId(c: Context, ctx: AppContext): Promise<string | undefined> {
  return (await currentSession(c, ctx))?.userId
}

/** Sign this browser out: end its server-side session and drop the cookie. */
export async function clearSession(c: Context, ctx: AppContext): Promise<void> {
  const session = await currentSession(c, ctx)
  if (session) await store.endBrowserSession(ctx.sql, session.userId, session.id)
  deleteCookie(c, COOKIE, { path: "/" })
}

function isHttps(config: IdentityConfig): boolean {
  return (config.publicUrl ?? "").startsWith("https:")
}

/**
 * Where to land after signing in. Only same-site dashboard pages and the agent authorize step are allowed, so the
 * cookie can't be used as an open redirect.
 */
const NEXT = "parley_next"
const SAFE_NEXT = /^\/(app(\/[\w-]+)*|oauth\/authorize\?[^\s]*)$/

export function rememberNext(c: Context, ctx: AppContext, next: string): void {
  if (SAFE_NEXT.test(next)) setCookie(c, NEXT, next, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 900, secure: isHttps(ctx.config) })
}

/** The remembered destination (cleared once read), or `/app`. */
export function takeNext(c: Context): string {
  const next = getCookie(c, NEXT)
  deleteCookie(c, NEXT, { path: "/" })
  return next && SAFE_NEXT.test(next) ? next : "/app"
}
