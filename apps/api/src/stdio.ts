import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { WHATSAPP_CAPABILITIES, WHATSAPP_ID } from "@parley/channels/whatsapp/meta"
import type { AppContext } from "./context.ts"
import { buildMcpServer } from "./mcp/server.ts"

/**
 * A stdio build of Parley's MCP server that describes its tools and does nothing else. It's here so registries that
 * build a server from its Dockerfile (Glama) can list the real tool definitions without a database, a session pool,
 * or a signed-in account. Using the tools means the hosted server: https://app.itsparley.com/mcp (OAuth sign-in).
 */
const HOSTED = "https://app.itsparley.com"
const NOTICE = `This local build of Parley only describes its tools. To use them, connect your agent to ${HOSTED}/mcp and sign in.`

const ctx = new Proxy({
  config: { version: process.env.PARLEY_VERSION ?? "dev", publicUrl: HOSTED },
  channels: [{ id: WHATSAPP_ID, capabilities: WHATSAPP_CAPABILITIES, open: () => Promise.reject(new Error(NOTICE)) }],
} as unknown as AppContext, {
  get(target, key) {
    if (key in target) return target[key as keyof AppContext]
    throw new Error(NOTICE)
  },
})

/** Tools that need no account or database, so they really run here (a registry's "try it" gets a real answer). */
const LOCAL_TOOLS = new Set(["list_channels"])

const server = buildMcpServer(ctx)
type Handler = (request: { params: { name: string } }, extra: unknown) => Promise<unknown>
const handlers = (server.server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers
const realCall = handlers.get("tools/call")
server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
  realCall && LOCAL_TOOLS.has(request.params.name)
    ? (realCall(request, extra) as never)
    : { isError: true, content: [{ type: "text", text: NOTICE }] })
await server.connect(new StdioServerTransport())
