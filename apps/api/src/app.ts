import { Hono } from "hono"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { AppContext } from "./context.ts"
import { oauthRoutes } from "./oauth/routes.ts"
import { buildMcpServer } from "./mcp/server.ts"

/**
 * Parley's HTTP app: the OAuth 2.1 authorization server, plus the MCP endpoint at `/mcp` (Streamable HTTP). The MCP
 * endpoint is a protected resource — a request without a valid bearer token is answered 401 with a `WWW-Authenticate`
 * header that points agents at the protected-resource metadata, which is how MCP clients discover where to sign in.
 */
export function makeApp(ctx: AppContext): Hono {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true, env: ctx.config.env, version: ctx.config.version }))
  app.route("/", oauthRoutes(ctx))

  app.all("/mcp", async (c) => {
    const base = ctx.config.publicUrl ?? new URL(c.req.url).origin
    const challenge = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": challenge })

    let userId: string
    try {
      userId = (await (await ctx.accessTokenKeys).verify(token)).userId
    } catch {
      return c.json({ error: "invalid_token" }, 401, { "WWW-Authenticate": challenge })
    }

    // Stateless: a fresh server + transport per request, so there's no cross-request state to leak.
    const server = buildMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw, { authInfo: { token, clientId: "", scopes: ["mcp"], extra: { userId } } })
  })

  return app
}
