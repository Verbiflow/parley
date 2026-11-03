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

  const filters = {
    channel: z.string().optional().describe("Only this channel, e.g. \"whatsapp\". Omit for every connected channel."),
    connection_id: z.string().optional().describe("Only this connection (if you have several on one channel)."),
  }
  const pickUrl = `${base}/app`

  server.registerTool(
    "read_inbox",
    {
      title: "Read inbox",
      description: "Read recent messages across all your connected channels, newest first — only from the chats the account holder chose to sync. Filter by channel, connection, or one chat (chat_id from list_chats). Page back with `before`.",
      inputSchema: {
        ...filters,
        chat_id: z.string().optional().describe("Only this chat (a chat_id from list_chats or from an earlier message)."),
        limit: z.number().int().min(1).max(200).optional().describe("How many messages (default 50)."),
        before: z.string().datetime().optional().describe("Only messages sent before this ISO time — pass the `at` of the oldest message you have to page back."),
      },
    },
    async ({ channel, connection_id, chat_id, limit, before }, extra) => {
      const userId = principalOf(extra)
      try {
        const messages = await ctx.sessions.inbox(userId, { channel, connectionId: connection_id, chatId: chat_id, limit: limit ?? 50, before })
        const out: Record<string, unknown> = {
          messages: messages.map((m) => ({
            channel: m.channel, connection_id: m.connectionId, chat_id: m.chatId, chat_name: m.chatName, chat_kind: m.chatKind,
            id: m.id, from: m.fromMe ? "me" : m.sender, from_me: m.fromMe, text: m.text, at: m.at,
          })),
        }
        if (!messages.length) {
          const chats = await ctx.sessions.inboxChats(userId, { channel, connectionId: connection_id })
          out.note = chats.length
            ? "No messages yet in the synced chats (matching your filters)."
            : `No chats are synced${channel ? ` on ${channel}` : ""}. Ask the account holder to connect a channel and choose chats at ${pickUrl}`
        }
        return json(out)
      } catch (e) {
        return fail(e instanceof ConnectError ? e.message : "could not read the inbox")
      }
    }
  )

  server.registerTool(
    "list_chats",
    {
      title: "List chats",
      description: "List the chats (people and groups) the account holder chose to sync, across all connected channels, most recent first. Filter by channel or connection.",
      inputSchema: filters,
    },
    async ({ channel, connection_id }, extra) => {
      const userId = principalOf(extra)
      try {
        const chats = await ctx.sessions.inboxChats(userId, { channel, connectionId: connection_id })
        return json({
          chats: chats.map((c) => ({ channel: c.channel, connection_id: c.connectionId, chat_id: c.id, name: c.name, kind: c.kind, last_message_at: c.lastMessageAt })),
          ...(chats.length ? {} : { note: `No chats are synced. Ask the account holder to choose chats at ${pickUrl}` }),
        })
      } catch (e) {
        return fail(e instanceof ConnectError ? e.message : "could not list chats")
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
