import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ACTIONS, isValidTimeZone } from "@parley/pacing"
import { z } from "zod"
import type { AppContext } from "../context.ts"
import { ConnectError } from "../sessions/actor.ts"
import { OutboxError, availability, cancel, listOutbound, type Outbound } from "../sessions/outbox.ts"

/** The principal a verified bearer token carries into a tool call (set by the /mcp bearer middleware). */
export type McpPrincipal = { userId: string; sessionId: string }

function principalOf(extra: { authInfo?: { extra?: unknown } } | undefined): McpPrincipal {
  const p = extra?.authInfo?.extra as McpPrincipal | undefined
  if (!p?.userId) throw new Error("unauthenticated")
  return p
}

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] })
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] })
const known = (e: unknown) => e instanceof ConnectError || e instanceof OutboxError

const WAIT_TEXT: Record<string, string> = {
  paused: "the connection is paused",
  queued: "earlier messages of the same kind go first",
  gap: "a short gap after the previous send",
  outside_active_hours: "outside the account's active hours",
  break: "a break after a burst of activity",
  action_spacing: "spacing between conversation openers",
  daily_cap: "today's limit is used up",
  weekly_cap: "this week's limit is used up",
}

const outboundView = (m: Outbound) => ({
  id: m.id, connection_id: m.connectionId, to: m.chatId, kind: m.kind, text: m.text, status: m.status,
  scheduled_for: m.scheduledFor, sent_at: m.sentAt, error: m.error, created_at: m.createdAt,
})

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
    { title: "List connections", description: "List the messaging-channel connections on your Parley account, with whether each can send right now.", inputSchema: {} },
    async (_args, extra) => {
      const { userId } = principalOf(extra)
      const connections = await ctx.sessions.list(userId)
      return json({
        connections: connections.map((c) => ({
          id: c.id, channel: c.channel, status: c.status, handle: c.handle, timezone: c.timezone, country: c.country,
          halted: c.haltedReason, paused_until: c.pausedUntil,
        })),
      })
    }
  )

  server.registerTool(
    "connect",
    {
      title: "Connect a channel",
      description: "Start linking one of your messaging accounts (e.g. WhatsApp) to Parley. Returns a link URL to open in a browser (scan the QR / authorize), and a connection id to poll with connection_status.",
      inputSchema: {
        channel: z.string().describe("Channel id, e.g. \"whatsapp\". Use list_channels to see options."),
        timezone: z.string().refine(isValidTimeZone, "unknown IANA time zone").optional().describe("IANA time zone the account holder lives in, e.g. \"Europe/London\". Messages go out during their local daytime. Defaults to UTC."),
        country: z.string().regex(/^[A-Za-z]{2}$/).optional().describe("ISO country code the account lives in, e.g. \"GB\". Picks a proxy exit there; learned from the phone number when omitted."),
      },
    },
    async ({ channel, timezone, country }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const started = await ctx.sessions.connect(userId, channel, { timezone, country })
        return json({
          connection_id: started.connectionId,
          channel: started.channel,
          link_method: started.linkMethod,
          link_url: base ? `${base}/link/${started.connectionId}` : `/link/${started.connectionId}`,
          next: "Open link_url in a browser to finish linking, then poll connection_status until status is \"connected\".",
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not start connecting")
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
      const { userId } = principalOf(extra)
      try {
        return json(await ctx.sessions.status(userId, connection_id))
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not read status")
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
      description: "Read recent messages across all your connected channels, newest first — from every chat except ones the account holder ignored. Filter by channel, connection, or one chat (chat_id from list_chats). Page back with `before`.",
      inputSchema: {
        ...filters,
        chat_id: z.string().optional().describe("Only this chat (a chat_id from list_chats or from an earlier message)."),
        limit: z.number().int().min(1).max(200).optional().describe("How many messages (default 50)."),
        before: z.string().datetime().optional().describe("Only messages sent before this ISO time — pass the `at` of the oldest message you have to page back."),
      },
    },
    async ({ channel, connection_id, chat_id, limit, before }, extra) => {
      const { userId } = principalOf(extra)
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
            : `No chats are synced${channel ? ` on ${channel}` : ""}. Ask the account holder to connect a channel (their chats are at ${pickUrl})`
        }
        return json(out)
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not read the inbox")
      }
    }
  )

  server.registerTool(
    "list_chats",
    {
      title: "List chats",
      description: "List the chats (people and groups) agents can see (everything except what the account holder ignored), across all connected channels, most recent first. `awaiting` says who owes the next message: \"you\" when the last word was theirs. Set awaiting_reply to get just the conversations waiting on you.",
      inputSchema: { ...filters, awaiting_reply: z.boolean().optional().describe("Only chats whose last message came from the other side.") },
    },
    async ({ channel, connection_id, awaiting_reply }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const chats = await ctx.sessions.inboxChats(userId, { channel, connectionId: connection_id, awaitingReply: awaiting_reply })
        return json({
          chats: chats.map((c) => ({ channel: c.channel, connection_id: c.connectionId, chat_id: c.id, name: c.name, kind: c.kind, last_message_at: c.lastMessageAt, awaiting: c.awaiting })),
          ...(chats.length ? {} : { note: awaiting_reply ? "Nothing is waiting on you." : `No chats are visible. The account holder may have ignored them all; their chats are at ${pickUrl}` }),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not list chats")
      }
    }
  )

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Queue a message on a connected channel. Parley sends at a human pace to keep the account safe: inside the account's local active hours, with gaps between sends, breaks after bursts, and daily limits that grow as a new account warms up. The reply says when it will go out (scheduled_for) and why it isn't sooner (waits). Replies in existing conversations go ahead of conversation openers that hit their limit.",
      inputSchema: {
        connection_id: z.string(),
        to: z.string().describe("Recipient on the channel: a chat_id from list_chats, or a phone number for WhatsApp."),
        text: z.string().min(1).max(8000),
        kind: z.enum(ACTIONS).optional().describe("What the send costs the account. Defaults to \"message\" in an existing conversation and \"first_message\" to someone new."),
        not_before: z.string().datetime().optional().describe("Don't send before this ISO time."),
        idempotency_key: z.string().min(1).max(200).optional().describe("Retrying with the same key returns the original message instead of sending twice."),
      },
    },
    async ({ connection_id, to, text, kind, not_before, idempotency_key }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        const { message, replayed } = await ctx.sessions.enqueue(userId, connection_id, {
          to, text, kind, notBefore: not_before ? new Date(not_before) : undefined, idempotencyKey: idempotency_key, agentSessionId: sessionId,
        })
        const now = !message.held && message.scheduledFor && Date.parse(message.scheduledFor) <= Date.now() + 1000
        return json({
          ...outboundView(message),
          replayed,
          waits: message.waits,
          note: message.held
            ? "Queued, but the connection is paused; it sends once the account holder resumes it."
            : now ? "Queued; it goes out now." : `Queued for ${message.scheduledFor}: ${message.waits.map((w) => WAIT_TEXT[w] ?? w).join(", ")}.`,
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not send")
      }
    }
  )

  server.registerTool(
    "send_availability",
    {
      title: "Send availability",
      description: "Whether a connection can send right now, and if not, when each kind of message could next go out and why. Includes today's usage against the account's (warming-up) daily allowance.",
      inputSchema: { connection_id: z.string() },
    },
    async ({ connection_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const { connection, actions } = await availability(ctx.sql, userId, connection_id, new Date())
        return json({
          connection_id, timezone: connection.timezone, halted: connection.haltedReason,
          paused_until: connection.pausedUntil && connection.pausedUntil > new Date() ? connection.pausedUntil.toISOString() : null,
          actions: Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, {
            can_send_now: a!.canSendNow, earliest_at: a!.earliestAt, waits: a!.waits, reason: a!.reason, used_today: a!.usedToday, daily_allowance: a!.allowance,
          }])),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not read availability")
      }
    }
  )

  server.registerTool(
    "list_outbox",
    {
      title: "List outbox",
      description: "Messages you queued: scheduled ones in send order, then sent, failed and canceled ones. A failed message carries an error code; outcome_unknown means the send was interrupted and may or may not have arrived.",
      inputSchema: {
        connection_id: z.string().optional(),
        status: z.enum(["scheduled", "sending", "sent", "failed", "canceled"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ connection_id, status, limit }, extra) => {
      const { userId } = principalOf(extra)
      try {
        return json({ messages: (await listOutbound(ctx.sql, userId, { connectionId: connection_id, status, limit: limit ?? 50 })).map(outboundView) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not list the outbox")
      }
    }
  )

  server.registerTool(
    "cancel_message",
    { title: "Cancel a message", description: "Cancel a message that is still scheduled. Messages already sent or sending can't be canceled.", inputSchema: { message_id: z.string() } },
    async ({ message_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        return json(outboundView(await cancel(ctx.tx, userId, message_id, new Date())))
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not cancel")
      }
    }
  )

  return server
}
