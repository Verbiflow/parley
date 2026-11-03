import { Hono } from "hono"
import QRCode from "qrcode"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { AppContext } from "./context.ts"
import { oauthRoutes } from "./oauth/routes.ts"
import { webRoutes } from "./web/routes.ts"
import { linkPage } from "./web/pages.ts"
import { buildMcpServer } from "./mcp/server.ts"
import { ConnectError } from "./sessions/actor.ts"
import { isSessionEnded, recordAgentUse } from "./oauth/store.ts"

/**
 * Parley's HTTP app: the OAuth 2.1 authorization server, plus the MCP endpoint at `/mcp` (Streamable HTTP). The MCP
 * endpoint is a protected resource — a request without a valid bearer token is answered 401 with a `WWW-Authenticate`
 * header that points agents at the protected-resource metadata, which is how MCP clients discover where to sign in.
 */
export function makeApp(ctx: AppContext): Hono {
  const app = new Hono()

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
      return c.json({ status: view.status, channel: view.channel, link_method: view.link?.method, qr_svg: qrSvg, chats_url: `/app/connections/${c.req.param("id")}/chats` })
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

    // Activity for the dashboard ("which agent is using this right now"). Best-effort: never fails the request.
    if (c.req.method === "POST") {
      const body = await c.req.raw.clone().json().catch(() => undefined)
      const calls = (Array.isArray(body) ? body : [body]).filter((m) => m?.method === "tools/call").map((m) => String(m.params?.name ?? ""))
      void recordAgentUse(ctx.sql, userId, sessionId, calls.at(-1) || null).catch(() => {})
    }

    // Stateless: a fresh server + transport per request, so there's no cross-request state to leak.
    const server = buildMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw, { authInfo: { token, clientId: "", scopes: ["mcp"], extra: { userId } } })
  })

  return app
}
