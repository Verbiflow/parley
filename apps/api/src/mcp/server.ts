import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { AppContext } from "../context.ts"
import { ConnectError } from "../sessions/actor.ts"

/** The principal a verified bearer token carries into a tool call (set by the /mcp bearer middleware). */
export type McpPrincipal = { userId: string }

function principalOf(extra: { authInfo?: { extra?: unknown } } | undefined): string {
  const p = extra?.authInfo?.extra as McpPrincipal | undefined
  if (!p?.userId) throw new Error("unauthenticated")
  return p.userId
}

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] })
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] })

/**
 * A fresh MCP server per request (stateless Streamable HTTP), exposing Parley's tools. Every tool reads the caller
 * from the verified token and is channel-generic: `connect` and `list_channels` enumerate the registry, so a new
 * integration appears here with no changes to this file.
 */
export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "parley", version: ctx.config.version })
  const base = ctx.config.publicUrl ?? ""

  server.registerTool(
    "list_channels",
    { title: "List channels", description: "List the messaging channels Parley supports and each channel's capabilities (how you link it, media/groups/threads).", inputSchema: {} },
    async () => json({ channels: ctx.channels.map((c) => ({ id: c.id, capabilities: c.capabilities })) })
  )

  server.registerTool(
    "list_connections",
    { title: "List connections", description: "List the messaging-channel connections on your Parley account.", inputSchema: {} },
    async (_args, extra) => {
      const userId = principalOf(extra)
      const connections = await ctx.sessions.list(userId)
      return json({ connections: connections.map((c) => ({ id: c.id, channel: c.channel, status: c.status, handle: c.handle })) })
    }
  )

  server.registerTool(
    "connect",
    {
      title: "Connect a channel",
      description: "Start linking one of your messaging accounts (e.g. WhatsApp) to Parley. Returns a link URL to open in a browser (scan the QR / authorize), and a connection id to poll with connection_status.",
      inputSchema: { channel: z.string().describe("Channel id, e.g. \"whatsapp\". Use list_channels to see options.") },
    },
    async ({ channel }, extra) => {
      const userId = principalOf(extra)
      try {
        const started = await ctx.sessions.connect(userId, channel)
        return json({
          connection_id: started.connectionId,
          channel: started.channel,
          link_method: started.linkMethod,
          link_url: base ? `${base}/link/${started.connectionId}` : `/link/${started.connectionId}`,
          next: "Open link_url in a browser to finish linking, then poll connection_status until status is \"connected\".",
        })
      } catch (e) {
        return fail(e instanceof ConnectError ? e.message : "could not start connecting")
      }
    }
  )

  server.registerTool(
    "connection_status",
    {
      title: "Connection status",
      description: "Check a connection. While linking, returns the link material (e.g. the WhatsApp QR string). Returns \"connected\" once live.",
      inputSchema: { connection_id: z.string() },
    },
    async ({ connection_id }, extra) => {
      const userId = principalOf(extra)
      try {
        return json(await ctx.sessions.status(userId, connection_id))
      } catch (e) {
        return fail(e instanceof ConnectError ? e.message : "could not read status")
      }
    }
  )

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description: "Send a message on a connected channel.",
      inputSchema: {
        connection_id: z.string(),
        to: z.string().describe("Recipient address on the channel (e.g. a phone number for WhatsApp)."),
        text: z.string(),
      },
    },
    async ({ connection_id, to, text }, extra) => {
      const userId = principalOf(extra)
      try {
        return json(await ctx.sessions.send(userId, connection_id, to, text))
      } catch (e) {
        return fail(e instanceof ConnectError ? e.message : "could not send")
      }
    }
  )

  return server
}
