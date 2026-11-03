import { Hono } from "hono"
import QRCode from "qrcode"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { AppContext } from "./context.ts"
import { oauthRoutes } from "./oauth/routes.ts"
import { buildMcpServer } from "./mcp/server.ts"
import { ConnectError } from "./sessions/actor.ts"

/**
 * Parley's HTTP app: the OAuth 2.1 authorization server, plus the MCP endpoint at `/mcp` (Streamable HTTP). The MCP
 * endpoint is a protected resource — a request without a valid bearer token is answered 401 with a `WWW-Authenticate`
 * header that points agents at the protected-resource metadata, which is how MCP clients discover where to sign in.
 */
export function makeApp(ctx: AppContext): Hono {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true, env: ctx.config.env, version: ctx.config.version }))
  app.route("/", oauthRoutes(ctx))

  // The link page: the user opens the link_url from `connect`, finishes linking (scans the QR), and watches it go
  // live. Access is the unguessable connection id (a capability URL); it needs no sign-in of its own.
  app.get("/link/:id/status", async (c) => {
    try {
      const view = await ctx.sessions.linkView(c.req.param("id"))
      let qrSvg: string | undefined
      if (view.link?.method === "qr") qrSvg = await QRCode.toString(view.link.data, { type: "svg", margin: 1, width: 280 })
      return c.json({ status: view.status, channel: view.channel, link_method: view.link?.method, qr_svg: qrSvg })
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

/** A tiny self-refreshing link page: shows the QR while linking, flips to "Connected" when the socket opens. */
function linkPage(id: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link a channel · Parley</title></head>
<body style="font-family:system-ui;max-width:28rem;margin:3rem auto;text-align:center">
<h1>Link your account</h1>
<div id="body"><p>Loading…</p></div>
<script>
const id=${JSON.stringify(id)}
async function tick(){
  try{
    const r=await fetch('/link/'+id+'/status'); const d=await r.json()
    const b=document.getElementById('body')
    if(d.status==='connected'){ b.innerHTML='<h2>✅ Connected</h2><p>You can close this tab.</p>'; return }
    if(d.qr_svg){ b.innerHTML='<p>Scan this with '+(d.channel||'your app')+':</p>'+d.qr_svg }
    else if(d.link_method){ b.innerHTML='<p>Linking ('+d.link_method+')…</p>' }
    else { b.innerHTML='<p>Preparing the link…</p>' }
  }catch(e){}
  setTimeout(tick,2000)
}
tick()
</script></body></html>`
}
