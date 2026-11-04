import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ACTIONS, isValidTimeZone } from "@parley/pacing"
import { z } from "zod"
import type { AppContext } from "../context.ts"
import { ConnectError } from "../sessions/actor.ts"
import type { StoredMessage } from "../sessions/chats.ts"
import { OutboxError, availability, cancel, getOutbound, listOutbound, type Outbound, type Queued } from "../sessions/outbox.ts"
import { MediaInputError, resolveMedia } from "./media.ts"
import { signMediaLink } from "../media-link.ts"
import { AccountError, accountLabel, findConnection, pickConnection } from "./accounts.ts"

/** The principal a verified bearer token carries into a tool call (set by the /mcp bearer middleware). */
export type McpPrincipal = { userId: string; sessionId: string }

function principalOf(extra: { authInfo?: { extra?: unknown } } | undefined): McpPrincipal {
  const p = extra?.authInfo?.extra as McpPrincipal | undefined
  if (!p?.userId) throw new Error("unauthenticated")
  return p
}

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] })
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const known = (e: unknown) => e instanceof ConnectError || e instanceof OutboxError || e instanceof MediaInputError || e instanceof AccountError

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
  ...(m.media ? { media: { kind: m.media.kind, mimetype: m.media.mimetype, file_name: m.media.fileName ?? null } } : {}),
  ...(m.reactTo ? { reaction_to: m.reactTo } : {}),
  ...(m.unsend ? { deletes: m.unsend } : {}),
  scheduled_for: m.scheduledFor, sent_at: m.sentAt, error: m.error, created_at: m.createdAt,
})

/** Sizes up to which get_media hands a file over inline (bigger ones: the download link). Claude's own image limit is 5 MB. */
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024
const INLINE_FILE_BYTES = 10 * 1024 * 1024
const INLINE_TEXT_BYTES = 512 * 1024
const TEXTUAL = /^(text\/|application\/(json|xml|csv|x-ndjson|yaml|x-yaml|javascript)$)/

const FOLLOW_UP = "Call message_status with this id to see whether it has gone out."

/** A message as agents see it (read_inbox, load_history). */
function messageOut(m: StoredMessage) {
  return {
    id: m.id, from: m.fromMe ? "me" : m.sender, from_me: m.fromMe, text: m.text, at: m.at,
    ...(m.media ? { media: { kind: m.media.kind, mimetype: m.media.mimetype, file_name: m.media.fileName ?? null, size: m.media.size ?? null, width: m.media.width ?? null, height: m.media.height ?? null, seconds: m.media.seconds ?? null } } : {}),
    ...(m.reactions.length ? { reactions: m.reactions.map((r) => ({ from: r.fromMe ? "me" : r.from, emoji: r.emoji, at: r.at })) } : {}),
  }
}

/** What send_message, react_to_message and delete_message answer: the queued row, and when it goes out. */
function queuedView(message: Queued, replayed: boolean) {
  const now = !message.held && message.scheduledFor && Date.parse(message.scheduledFor) <= Date.now() + 1000
  return {
    ...outboundView(message),
    replayed,
    waits: message.waits,
    note: message.held
      ? "Queued, but the connection is paused; it sends once the account holder resumes it."
      : now ? "Queued; it goes out now." : `Queued for ${message.scheduledFor}: ${message.waits.map((w) => WAIT_TEXT[w] ?? w).join(", ")}.`,
    next: FOLLOW_UP,
  }
}

/** What message_status answers: the row, and a plain-words reading of where it stands. */
function statusView(m: Outbound) {
  const what = m.unsend ? "The deletion" : m.reactTo ? "The reaction" : m.media ? `The ${m.media.kind}` : "The message"
  const note = {
    scheduled: m.scheduledFor
      ? Date.parse(m.scheduledFor) <= Date.now() + 1000
        ? `${what} is due now and goes out within moments. Check again shortly.`
        : `${what} is waiting its turn; it goes out at ${m.scheduledFor}. Call send_availability to see why it isn't sooner.`
      : `${what} is held: the connection is paused or offline. It sends once the account holder resumes it (check list_connections).`,
    sending: `${what} is being sent right now. Check again in a few seconds.`,
    sent: `${what} went out at ${m.sentAt}.`,
    failed: m.error?.code === "outcome_unknown"
      ? `${what} may or may not have arrived: the send was interrupted. Check the chat with read_inbox before sending again.`
      : `${what} failed: ${m.error?.message ?? "unknown error"}.`,
    canceled: `${what} was canceled.`,
  }[m.status]
  return { ...outboundView(m), attempts: m.attempts, note }
}

/**
 * A fresh MCP server per request (stateless Streamable HTTP), exposing Parley's tools. Every tool reads the caller
 * from the verified token and is channel-generic: `connect` and `list_channels` enumerate the registry, so a new
 * integration appears here with no changes to this file.
 */
export function buildMcpServer(ctx: AppContext, origin?: string): McpServer {
  const server = new McpServer({ name: "parley", version: ctx.config.version })
  const base = ctx.config.publicUrl ?? origin ?? ""

  server.registerTool(
    "list_channels",
    { title: "List channels", description: "List the messaging channels Parley supports and each channel's capabilities (how you link it, media/groups/threads).", inputSchema: {} },
    async () => json({ channels: ctx.channels.map((c) => ({ id: c.id, capabilities: c.capabilities })) })
  )

  server.registerTool(
    "list_connections",
    {
      title: "List connections",
      description: "List the messaging accounts linked to Parley (there can be several per channel, e.g. a personal and a work WhatsApp), with each one's number (`account`) and whether it can send right now. Other tools take `connection_id`: this id, or simply the account's number.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { userId } = principalOf(extra)
      const connections = (await ctx.sessions.list(userId)).filter((c) => c.status !== "logged_out" && c.status !== "error")
      const live = connections.filter((c) => c.status === "connected")
      return json({
        connections: connections.map((c) => ({
          id: c.id, channel: c.channel, account: accountLabel(c), name: c.displayName, status: c.status, handle: c.handle, timezone: c.timezone, country: c.country,
          halted: c.haltedReason, paused_until: c.pausedUntil,
        })),
        note: live.length > 1
          ? "Several accounts are connected: pass connection_id (an id above, or the account number) to say which one sends. Reading tools cover every account unless you filter."
          : live.length === 1 ? "One account is connected; tools use it when you leave connection_id out." : "Nothing is connected yet. Call connect to link an account.",
      })
    }
  )

  server.registerTool(
    "connect",
    {
      title: "Connect a channel",
      description: "Start linking a messaging account (e.g. WhatsApp) to Parley. You can link several on one channel (another WhatsApp number is just another connect); linking a number that is already linked replaces the old link. Returns a link URL to open in a browser (scan the QR / authorize), and a connection id to poll with connection_status.",
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
    connection_id: z.string().optional().describe("Only this account: a connection id from list_connections, or its number (e.g. \"+65 9136 3557\")."),
  }
  /** Turn the filters an agent passed into the store's, resolving a number to its connection. */
  const scope = async (userId: string, f: { channel?: string | undefined; connection_id?: string | undefined }) => ({
    channel: f.channel, connectionId: (await findConnection(ctx, userId, f.connection_id, f.channel))?.id,
  })
  /** connection id → its number, so agents with several accounts can tell which one a chat or message is on. */
  const labels = async (userId: string) => new Map((await ctx.sessions.list(userId)).map((c) => [c.id, accountLabel(c)]))
  const ACCOUNT_REF = "Which of your accounts: a connection id from list_connections, or the account's number. Optional when only one account fits."
  const pickUrl = `${base}/app`

  server.registerTool(
    "read_inbox",
    {
      title: "Read inbox",
      description: "Read recent messages across all your connected accounts, newest first (each says which `account` it is on) — from every chat except ones the account holder ignored. Filter by channel, connection, or one chat (chat_id from list_chats). Page back with `before`. A message with `media` carries a photo, video, voice note, document or sticker (its `text` is the caption, or a placeholder like \"[photo]\"): call get_media to see it. `reactions` lists who reacted with what.",
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
        const where = await scope(userId, { channel, connection_id })
        const [messages, account] = await Promise.all([ctx.sessions.inbox(userId, { ...where, chatId: chat_id, limit: limit ?? 50, before }), labels(userId)])
        const out: Record<string, unknown> = {
          messages: messages.map((m) => ({
            channel: m.channel, connection_id: m.connectionId, account: account.get(m.connectionId) ?? null, chat_id: m.chatId, chat_name: m.chatName, chat_kind: m.chatKind,
            ...messageOut(m),
          })),
        }
        if (!messages.length) {
          const chats = await ctx.sessions.inboxChats(userId, where)
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
      description: "List the chats (people and groups) agents can see (everything except what the account holder ignored), across all connected accounts, most recent first (the same person can appear once per account). `awaiting` says who owes the next message: \"you\" when the last word was theirs. Set awaiting_reply to get just the conversations waiting on you.",
      inputSchema: { ...filters, awaiting_reply: z.boolean().optional().describe("Only chats whose last message came from the other side.") },
    },
    async ({ channel, connection_id, awaiting_reply }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const [chats, account] = await Promise.all([ctx.sessions.inboxChats(userId, { ...(await scope(userId, { channel, connection_id })), awaitingReply: awaiting_reply }), labels(userId)])
        return json({
          chats: chats.map((c) => ({ channel: c.channel, connection_id: c.connectionId, account: account.get(c.connectionId) ?? null, chat_id: c.id, name: c.name, kind: c.kind, last_message_at: c.lastMessageAt, awaiting: c.awaiting })),
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
        "Queue a message on a connected channel: text, or a photo, video, voice note or document (pass `media`; `text` is then its caption). Parley sends at a human pace to keep the account safe: inside the account's local active hours, with gaps between sends, breaks after bursts, and daily limits that grow as a new account warms up. The reply says when it will go out (scheduled_for) and why it isn't sooner (waits). Replies in existing conversations go ahead of conversation openers that hit their limit.",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account that has the \`to\` chat.`),
        to: z.string().describe("Recipient on the channel: a chat_id from list_chats, or a phone number for WhatsApp."),
        text: z.string().max(8000).optional().describe("The message, or the caption when sending media."),
        media: z.object({
          url: z.string().url().optional().describe("A public http(s) URL to download the file from."),
          data: z.string().optional().describe("Or the file itself, base64."),
          kind: z.enum(["image", "video", "audio", "document"]).optional().describe("How it shows in the chat. Defaults from the file type: JPEG/PNG/WebP photos and MP4 videos inline, audio as audio (OGG/Opus as a voice note), anything else as a document."),
          mimetype: z.string().max(200).optional().describe("The file's type, e.g. \"image/jpeg\". Defaults to what the URL serves, or the file name's extension."),
          file_name: z.string().max(200).optional().describe("Shown for documents."),
        }).optional().describe("A file to send: photos up to 16 MB; videos, audio and documents up to 100 MB from a url (16 MB as data). Give exactly one of url or data."),
        kind: z.enum(ACTIONS).optional().describe("What the send costs the account. Defaults to \"message\" in an existing conversation and \"first_message\" to someone new."),
        not_before: z.string().datetime().optional().describe("Don't send before this ISO time."),
        idempotency_key: z.string().min(1).max(200).optional().describe("Retrying with the same key returns the original message instead of sending twice."),
      },
    },
    async ({ connection_id, to, text, media, kind, not_before, idempotency_key }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        if (!text && !media) return fail("give `text`, `media`, or both")
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: to })
        const file = media ? resolveMedia(media) : undefined
        const { message, replayed } = await ctx.sessions.enqueue(userId, conn.id, {
          to, text: text ?? "", media: file, kind, notBefore: not_before ? new Date(not_before) : undefined, idempotencyKey: idempotency_key, agentSessionId: sessionId,
        })
        return json({ ...queuedView(message, replayed), account: accountLabel(conn) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not send")
      }
    }
  )

  server.registerTool(
    "load_history",
    {
      title: "Load a chat's history",
      description: "Get the last `count` messages of a chat from the account holder's phone, including ones Parley doesn't have (from before the account was linked, or that couldn't be read when they came in), with their attachments and reactions. Waits up to about 20 seconds for the phone, which must be online; returns the chat's last messages either way, and `answered` says whether the phone replied. Afterwards they're in read_inbox too.",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account that has the chat.`),
        chat_id: z.string().describe("The chat (chat_id from list_chats or read_inbox)."),
        count: z.number().int().min(1).max(50).optional().describe("How many of the latest messages (default 20, at most 50)."),
      },
    },
    async ({ connection_id, chat_id, count }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: chat_id })
        const { answered, messages } = await ctx.sessions.loadHistory(userId, conn.id, chat_id, count ?? 20)
        return json({
          account: accountLabel(conn), chat_id, answered, messages: messages.map(messageOut),
          ...(answered ? {} : { note: "The phone didn't answer in time (it may be offline or asleep). These are the messages Parley already has; try again later." }),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not load the history")
      }
    }
  )

  server.registerTool(
    "react_to_message",
    {
      title: "React to a message",
      description: "React to a message with an emoji, as the account holder would from their phone. Paced like a reply. Pass an empty emoji to take your reaction back; a new one replaces the old.",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account the message is on.`),
        chat_id: z.string().describe("The chat the message is in (chat_id from read_inbox)."),
        message_id: z.string().describe("The message's id from read_inbox."),
        emoji: z.string().max(32).describe("One emoji, e.g. \"👍\". Empty to remove your reaction."),
        idempotency_key: z.string().min(1).max(200).optional(),
      },
    },
    async ({ connection_id, chat_id, message_id, emoji, idempotency_key }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: chat_id, messageId: message_id })
        const { message, replayed } = await ctx.sessions.enqueue(userId, conn.id, {
          to: chat_id, text: emoji.trim(), reactTo: message_id, idempotencyKey: idempotency_key, agentSessionId: sessionId,
        })
        return json({ ...queuedView(message, replayed), account: accountLabel(conn) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not react")
      }
    }
  )

  server.registerTool(
    "delete_message",
    {
      title: "Delete a sent message",
      description: "Delete a message the account sent, for everyone in the chat, as the account holder would from their phone (the chat shows \"This message was deleted\"). Works on messages sent through Parley or from the phone, for about two days after sending. Paced like a reply; follow it with message_status. Still scheduled? Use cancel_message instead.",
      inputSchema: {
        message_id: z.string().describe("The id send_message returned, or the message's id from read_inbox (one with from_me)."),
        chat_id: z.string().optional().describe("The chat the message is in (chat_id from read_inbox). Not needed with an id send_message returned."),
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account the message is on.`),
        idempotency_key: z.string().min(1).max(200).optional(),
      },
    },
    async ({ message_id, chat_id, connection_id, idempotency_key }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        // Sent through Parley: the queued row says which account and chat. Otherwise the chat is needed to find it.
        const sent = UUID.test(message_id) ? await getOutbound(ctx.sql, userId, message_id) : undefined
        if (!sent && !chat_id) return fail("pass chat_id with a message id from read_inbox")
        const conn = sent
          ? (await findConnection(ctx, userId, sent.connectionId))!
          : await pickConnection(ctx, userId, connection_id, { chatId: chat_id!, messageId: message_id })
        const { message, replayed } = await ctx.sessions.enqueue(userId, conn.id, {
          to: sent?.chatId ?? chat_id!, text: "", unsend: message_id, idempotencyKey: idempotency_key, agentSessionId: sessionId,
        })
        return json({ ...queuedView(message, replayed), account: accountLabel(conn) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not delete the message")
      }
    }
  )

  server.registerTool(
    "get_media",
    {
      title: "Get a message's media",
      description:
        "Open the photo, video, voice note, document or sticker a message carries (a message from read_inbox with `media`). Always returns a `download_url` (any size, valid for an hour; fetch it with curl or code). Photos and stickers also come back as images you can see, voice notes and audio as audio, videos as their preview frame, PDFs as a document, and text files (txt, csv, json, …) as text. Needs the connection online; an old file may take a moment while the sender's phone uploads it again.",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account the message is on.`),
        chat_id: z.string(),
        message_id: z.string(),
      },
    },
    async ({ connection_id, chat_id, message_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: chat_id, messageId: message_id })
        const info = await ctx.sessions.mediaInfo(userId, conn.id, chat_id, message_id)
        const link = await signMediaLink(ctx.config.signInKey, { accountId: userId, connectionId: conn.id, chatId: chat_id, messageId: message_id })
        const mimeType = (info.mimetype ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase()
        const size = info.size ?? 0
        const about = {
          kind: info.kind, mimetype: info.mimetype, file_name: info.fileName ?? null, size: info.size ?? null,
          width: info.width ?? null, height: info.height ?? null, seconds: info.seconds ?? null,
          download_url: `${base}/media/${link.token}`, download_expires_at: link.expiresAt,
        }
        type Part = { type: "text"; text: string } | { type: "image" | "audio"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
        const parts: Part[] = []
        const fetchInline = async () => (await ctx.sessions.media(userId, conn.id, chat_id, message_id)).data
        if ((info.kind === "image" || info.kind === "sticker") && size <= INLINE_IMAGE_BYTES) {
          parts.push({ type: "image", data: await fetchInline(), mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg" })
        } else if (info.kind === "audio" && size <= INLINE_FILE_BYTES) {
          parts.push({ type: "audio", data: await fetchInline(), mimeType })
        } else if (info.kind === "document" && TEXTUAL.test(mimeType) && size <= INLINE_TEXT_BYTES) {
          parts.push({ type: "text", text: new TextDecoder().decode(Uint8Array.from(atob(await fetchInline()), (ch) => ch.charCodeAt(0))) })
        } else if (info.kind === "document" && mimeType === "application/pdf" && size <= INLINE_FILE_BYTES) {
          parts.push({ type: "resource", resource: { uri: about.download_url, mimeType, blob: await fetchInline() } })
        } else if (info.thumbnail) {
          // A video (or a file too big to inline): its preview, and the link for the real thing.
          parts.push({ type: "image", data: info.thumbnail, mimeType: "image/jpeg" })
          Object.assign(about, { note: info.kind === "video" ? "This is the video's preview frame; the full video is at download_url." : "This is a preview; the full file is at download_url." })
        } else {
          Object.assign(about, { note: "Download the file from download_url." })
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(about) }, ...parts] }
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not fetch the media")
      }
    }
  )

  server.registerTool(
    "send_availability",
    {
      title: "Send availability",
      description: "Whether a connection can send right now, and if not, when each kind of message could next go out and why. Includes today's sends against the account's daily limit, which every kind of message counts toward.",
      inputSchema: { connection_id: z.string().optional().describe(ACCOUNT_REF) },
    },
    async ({ connection_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id)
        const { connection, actions, today } = await availability(ctx.sql, userId, conn.id, new Date())
        return json({
          connection_id: conn.id, account: accountLabel(conn), timezone: connection.timezone, halted: connection.haltedReason,
          paused_until: connection.pausedUntil && connection.pausedUntil > new Date() ? connection.pausedUntil.toISOString() : null,
          sent_today: today.sentToday, daily_limit: today.dailyLimit,
          actions: Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, {
            can_send_now: a!.canSendNow, earliest_at: a!.earliestAt, waits: a!.waits, reason: a!.reason, used_today: a!.usedToday,
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
      description: "Messages you queued: scheduled ones in send order, then sent, failed and canceled ones. A failed message carries an error code; outcome_unknown means the send was interrupted and may or may not have arrived. To follow one message, use message_status.",
      inputSchema: {
        connection_id: z.string().optional().describe("Only this account: a connection id, or its number."),
        status: z.enum(["scheduled", "sending", "sent", "failed", "canceled"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ connection_id, status, limit }, extra) => {
      const { userId } = principalOf(extra)
      try {
        return json({ messages: (await listOutbound(ctx.sql, userId, { connectionId: (await findConnection(ctx, userId, connection_id))?.id, status, limit: limit ?? 50 })).map(outboundView) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not list the outbox")
      }
    }
  )

  server.registerTool(
    "message_status",
    {
      title: "Message status",
      description: "Check on one message, reaction or deletion you queued (the id send_message, react_to_message or delete_message returned): scheduled (with when it goes out), sending, sent (with when), failed (with why), or canceled. Poll this after a send to know it went out.",
      inputSchema: { message_id: z.string().describe("The id send_message, react_to_message or delete_message returned.") },
    },
    async ({ message_id }, extra) => {
      const { userId } = principalOf(extra)
      if (!UUID.test(message_id)) return fail("no such message")
      try {
        return json(statusView(await getOutbound(ctx.sql, userId, message_id)))
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not read the message")
      }
    }
  )

  server.registerTool(
    "cancel_message",
    { title: "Cancel a message", description: "Cancel a message that is still scheduled. Messages already sent or sending can't be canceled; to take back one that went out, use delete_message.", inputSchema: { message_id: z.string() } },
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
