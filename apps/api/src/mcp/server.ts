import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AppContext } from "../context.ts"

/** The principal a verified bearer token carries into a tool call (set by the /mcp bearer middleware). */
export type McpPrincipal = { userId: string }

/**
 * A fresh MCP server per request (stateless Streamable HTTP). It exposes Parley's tools; `list_connections` is the
 * first. Tools read the caller from `extra.authInfo.extra` (the verified token's principal). As channels land, the
 * tool set grows — `list_channels`, `connect`, `send_message` — all reading the registry, never branching per channel.
 */
export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "parley", version: ctx.config.version })

  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description: "List the messaging channels Parley supports, with each channel's capabilities (how you link it, whether it has media/groups/threads).",
      inputSchema: {},
    },
    async () => {
      const channels = ctx.channels.map((c) => ({ id: c.id, capabilities: c.capabilities }))
      return { content: [{ type: "text", text: JSON.stringify({ channels }) }] }
    }
  )

  server.registerTool(
    "list_connections",
    {
      title: "List connections",
      description: "List the messaging-channel connections on your Parley account.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const principal = extra?.authInfo?.extra as McpPrincipal | undefined
      if (!principal?.userId) throw new Error("unauthenticated")
      // Connections aren't persisted yet — the channel framework and its table arrive in a later phase.
      const connections: Array<{ id: string; channel: string; status: string }> = []
      return { content: [{ type: "text", text: JSON.stringify({ connections }) }] }
    }
  )

  return server
}
