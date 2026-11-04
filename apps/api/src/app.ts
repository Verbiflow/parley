import { Hono, type Context } from "hono"
import { getConnInfo } from "@hono/node-server/conninfo"
import QRCode from "qrcode"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { AppContext } from "./context.ts"
import { oauthRoutes } from "./oauth/routes.ts"
import { webRoutes } from "./web/routes.ts"
import { linkPage } from "./web/pages.ts"
import { buildMcpServer } from "./mcp/server.ts"
import { ConnectError } from "./sessions/actor.ts"
import { isSessionEnded, recordAgentUse } from "./oauth/store.ts"
import { LIMITS } from "./ratelimit.ts"
import { verifyMediaLink } from "./media-link.ts"

/**
 * The caller's address. Behind Cloudflare (production) that's `cf-connecting-ip`, which Cloudflare sets itself — the
 * first `x-forwarded-for` hop is whatever the client claims, so trusting it would let anyone rotate past the rate
 * limits. Elsewhere: the first hop a proxy in front of us reports, else the socket's peer.
 */
function clientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")
  if (cf) return cf
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded
  try {
    return getConnInfo(c).remote.address ?? "unknown"
  } catch {
    return "unknown"
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/quicktime": ".mov",
  "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "application/pdf": ".pdf",
}
const extension = (mimetype: string) => EXTENSIONS[mimetype.split(";")[0]!.trim().toLowerCase()] ?? ""

const SIGN_IN = /^\/(auth\/(dev|start|callback)|oauth\/(token|register|authorize))$/

/**
 * Parley's HTTP app: the OAuth 2.1 authorization server, plus the MCP endpoint at `/mcp` (Streamable HTTP). The MCP
 * endpoint is a protected resource — a request without a valid bearer token is answered 401 with a `WWW-Authenticate`
 * header that points agents at the protected-resource metadata, which is how MCP clients discover where to sign in.
 */
export function makeApp(ctx: AppContext): Hono {
  const app = new Hono()

  const tooMany = (c: Context, wait: number) =>
    c.json({ error: "rate_limited", error_description: `Too many requests. Retry in ${wait}s.` }, 429, { "Retry-After": String(wait) })

  // Sign-in endpoints take guesses at codes and passwords; dashboard writes change what agents can reach.
  app.use("*", async (c, next) => {
    if (c.req.method === "POST") {
      const rule = SIGN_IN.test(c.req.path) ? ["sign-in", LIMITS.signIn] as const : c.req.path.startsWith("/app/") ? ["dashboard", LIMITS.dashboardWrite] as const : undefined
      if (rule) {
        const wait = await ctx.limiter.hit(`${rule[0]}:${clientIp(c)}`, rule[1].limit, rule[1].windowSeconds)
        if (wait) return tooMany(c, wait)
      }
    }
    await next()
  })

  app.get("/health", (c) => c.json({ ok: true, env: ctx.config.env, version: ctx.config.version }))
  app.route("/", oauthRoutes(ctx))
  app.route("/", webRoutes(ctx))

  // The link page: the user opens the link_url from `connect`, finishes linking (scans the QR), and watches it go
  // live. Access is the unguessable connection id (a capability URL); it needs no sign-in of its own.
  app.get("/link/:id/status", async (c) => {
    try {
      await ctx.sessions.ensureLinking(c.req.param("id")).catch(() => {})
      const view = await ctx.sessions.linkView(c.req.param("id"))
      let qrSvg: string | undefined
      if (view.link?.method === "qr") qrSvg = await QRCode.toString(view.link.data, { type: "svg", margin: 1, width: 280 })
      return c.json({ status: view.status, channel: view.channel, link_method: view.link?.method, qr_svg: qrSvg, chats_url: `/app/connections/${c.req.param("id")}` })
    } catch (e) {
      return c.json({ error: e instanceof ConnectError ? e.message : "not found" }, 404)
    }
  })

  app.get("/link/:id", async (c) => {
    try {
      await ctx.sessions.linkView(c.req.param("id"))
    } catch {
      return c.text("Unknown connection.", 404)
    }
    return c.html(linkPage(c.req.param("id")))
  })

  // A message attachment, by signed link (from get_media). Served as a download, never rendered: whatever the file
  // claims to be, it can't run as a page on this origin.
  app.get("/media/:token", async (c) => {
    const claims = await verifyMediaLink(ctx.config.signInKey, c.req.param("token"))
    if (!claims) return c.text("This link is invalid or has expired. Ask for the file again with get_media.", 404)
    try {
      const file = await ctx.sessions.mediaStream(claims.accountId, claims.connectionId, claims.chatId, claims.messageId)
      const name = file.fileName || `${file.kind}-${claims.messageId}${extension(file.mimetype)}`
      return new Response(file.body, {
        headers: {
          "content-type": file.mimetype || "application/octet-stream",
          "content-disposition": `attachment; filename="${name.replace(/[^\w.\- ]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
      })
    } catch (e) {
      if (e instanceof ConnectError) return c.text(e.code === "not_connected" ? "The WhatsApp connection is offline; try again once it's back." : e.message, e.code === "not_connected" ? 503 : 404)
      console.error(JSON.stringify({ msg: "media download failed", error: e instanceof Error ? e.message : String(e) }))
      return c.text("Couldn't fetch the file from WhatsApp. Try again shortly.", 502)
    }
  })

  app.all("/mcp", async (c) => {
    const base = ctx.config.publicUrl ?? new URL(c.req.url).origin
    const challenge = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": challenge })

    let userId: string
    let sessionId: string
    try {
      const principal = await (await ctx.accessTokenKeys).verify(token)
      if (await isSessionEnded(ctx.sql, principal.deviceId)) throw new Error("session ended")
      userId = principal.userId
      sessionId = principal.deviceId
    } catch {
      return c.json({ error: "invalid_token" }, 401, { "WWW-Authenticate": challenge })
    }

    const wait = await ctx.limiter.hit(`mcp:${userId}`, LIMITS.mcp.limit, LIMITS.mcp.windowSeconds)
    if (wait) return tooMany(c, wait)

    // Activity for the dashboard ("which agent is using this right now"). Best-effort: never fails the request.
    if (c.req.method === "POST") {
      const body = await c.req.raw.clone().json().catch(() => undefined)
      const calls = (Array.isArray(body) ? body : [body]).filter((m) => m?.method === "tools/call").map((m) => String(m.params?.name ?? ""))
      // Awaited (one small write): on the edge the request's DB connection closes once the response is sent.
      await recordAgentUse(ctx.sql, userId, sessionId, calls.at(-1) || null).catch(() => {})
    }

    // Stateless: a fresh server + transport per request, so there's no cross-request state to leak.
    const server = buildMcpServer(ctx, base)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw, { authInfo: { token, clientId: "", scopes: ["mcp"], extra: { userId, sessionId } } })
  })

  return app
}
