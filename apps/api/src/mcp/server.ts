import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ACTIONS, isValidTimeZone, policyFor } from "@parley/pacing"
import { z } from "zod"
import type { AppContext } from "../context.ts"
import { ConnectError } from "../sessions/actor.ts"
import { getConnection } from "../sessions/store.ts"
import { historyAnchor, markRead, newByChat, newReactions, searchChats, type InboxFilter, type NewInChat, type StoredMessage } from "../sessions/chats.ts"
import { MAX_GAP_SECONDS, OutboxError, availability, cancel, getOutbound, listOutbound, type Outbound, type Queued } from "../sessions/outbox.ts"
import { MediaInputError, resolveMedia } from "./media.ts"
import { signMediaLink } from "../media-link.ts"
import { AccountError, accountLabel, findConnection, pickConnection } from "./accounts.ts"
import { EVENT_TEXT, MAX_ATTEMPTS, MAX_WEBHOOK_HEADERS, MAX_WEBHOOKS, WEBHOOK_EVENTS, WebhookError, type Delivery, type Webhook } from "../sessions/webhooks.ts"

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
const known = (e: unknown) => e instanceof ConnectError || e instanceof OutboxError || e instanceof MediaInputError || e instanceof AccountError || e instanceof WebhookError

/** The gap a connection keeps between two sends, in seconds, and whether the person chose it. */
function sendGap(channel: string, gapSeconds: number | null) {
  const g = gapSeconds === null ? policyFor(channel).gapSeconds : { min: gapSeconds, max: gapSeconds * 2 }
  return { min_seconds: g.min, max_seconds: g.max, custom: gapSeconds !== null }
}

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
  ...(m.typing ? { typing: true } : {}),
  scheduled_for: m.scheduledFor, sent_at: m.sentAt, error: m.error, created_at: m.createdAt,
})

/** Sizes up to which get_media hands a file over inline (bigger ones: the download link). Claude's own image limit is 5 MB. */
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024
const INLINE_FILE_BYTES = 10 * 1024 * 1024
const INLINE_TEXT_BYTES = 512 * 1024
const TEXTUAL = /^(text\/|application\/(json|xml|csv|x-ndjson|yaml|x-yaml|javascript)$)/

const FOLLOW_UP = "Call message_status with this id to see whether it has gone out."

const webhookView = (w: Webhook, account?: string | null) => ({
  id: w.id, connection_id: w.connectionId, ...(account !== undefined ? { account } : {}), url: w.url, events: w.events, description: w.description, enabled: w.enabled, created_by: w.createdBy,
  secret_ends_with: w.secretHint, headers: w.headers.map((h) => ({ name: h.name, value_ends_with: h.hint || null })), last_success_at: w.lastSuccessAt, last_failure_at: w.lastFailureAt, last_error: w.lastError, created_at: w.createdAt,
})
const deliveryOut = (d: Delivery, opts: { payload?: boolean } = {}) => ({
  id: d.id, webhook_id: d.webhookId, event: d.event, event_id: d.eventId, status: d.status, attempts: d.attempts,
  next_attempt_at: d.nextAttemptAt, last_status: d.lastStatus, last_error: d.lastError, created_at: d.createdAt, delivered_at: d.deliveredAt,
  ...(opts.payload ? { payload: d.payload } : {}),
})
/**
 * What a webhook request's JSON body looks like, for an agent writing the receiver: the envelope, each event's `data`,
 * and a whole example. Handed over with the secret (create_webhook) and on list_webhooks / test_webhook.
 */
const PAYLOAD = {
  envelope: "Every body: { id (the event id, same as the Parley-Event-Id header), type (the event, same as Parley-Event), created_at (when it happened), sent_at (when this request went: each retry and resend has its own; the id stays the same), connection: { id, channel, account (the number, e.g. \"+65 9136 3557\") }, data }.",
  data: {
    "message.received / message.sent": "data.chat { id, name, kind: \"direct\" | \"group\" }, data.message { id, from (sender id, or \"me\"), from_me, text (the text, or a media caption / placeholder like \"[photo]\"), at, media? { kind, mimetype, file_name, size, width, height, seconds, download_url (expires in an hour), download_expires_at } }",
    "reaction.added / reaction.removed": "data.chat, data.reaction { from, from_me, emoji (\"\" when removed), previous_emoji, at }, data.message { id, from, from_me, text } (the message reacted to)",
    "message.deleted": "data.chat, data.message { id, from, from_me, at } (no text: it stays deleted)",
    "webhook.test": "shaped like message.received: data.webhook_id, data.chat { id: \"test\", ... }, data.message { ..., text }",
  },
  read_text_at: "data.message.text (not data.text)",
  example: {
    id: "778c3c6a-3455-4d1a-a6d4-6d1ebd791f08", type: "message.received", created_at: "2026-11-05T00:11:04.224Z",
    connection: { id: "75490190-6bd4-4557-a353-fe51310c02a1", channel: "whatsapp", account: "+65 9136 3557" },
    data: {
      chat: { id: "14084203023@s.whatsapp.net", name: "Ana", kind: "direct" },
      message: { id: "3EB09F8B6C075FDDD15814", from: "14084203023@s.whatsapp.net", from_me: false, text: "hi there", at: "2026-11-05T00:11:03.000Z" },
    },
  },
}
/** How a receiver checks a request is Parley's, said once wherever a secret is handed over. */
const VERIFY = "Each request is a JSON POST with headers Parley-Event, Parley-Event-Id, Parley-Delivery-Id, Parley-Attempt and Parley-Signature: \"t=<unix seconds>,v1=<hex>\". To verify, compute HMAC-SHA256 with the secret (the whole whsec_… string) as the key over \"<t>.<raw request body>\", compare it to v1 in constant time, and reject a t more than 5 minutes old. Each request is also signed the Standard Webhooks way (standardwebhooks.com), so its libraries verify it with the same secret: headers webhook-id (the event id), webhook-timestamp and webhook-signature \"v1,<base64 HMAC-SHA256 of '<id>.<timestamp>.<body>' keyed with the base64-decoded part after whsec_>\" (a secret with - or _ in it predates that format: rotate it for a library). Answer any 2xx within 10 seconds; anything else is retried (" + MAX_ATTEMPTS + " attempts in all: at once, after 30 seconds, after 5 minutes). The same event can arrive twice: dedupe on Parley-Event-Id."
/** The custom headers input, the same for create and update. */
const headersInput = z.record(z.string().max(100), z.string().max(2000)).optional()
const HEADERS_DOC = `Headers of your own to send on every request, as { name: value }, for a receiver that checks who's calling: e.g. { "Authorization": "Bearer <key>" } or { "X-Api-Key": "<key>" }, exactly as the receiver's setup gives them. Sent alongside Parley's own headers and signature; kept sealed, and only each name and the value's last 4 characters are ever shown back. At most ${MAX_WEBHOOK_HEADERS}; Parley's own (Parley-*, Webhook-*, Content-Type, User-Agent, Host…) can't be set.`
const URL_DOC = "A public https URL (not a private, local or internal address). A key in it is fine (?token=…, or one in the path): the URL is kept sealed and shown back with its keys masked. user:password@ before the host is sent as an Authorization: Basic header instead."
const toHeaders = (h: Record<string, string> | undefined) => (h === undefined ? undefined : Object.entries(h).map(([name, value]) => ({ name, value })))
/** What a test or resend came to, said for the agent: delivered, failed and why (and what to do about a 401/403), or still waiting. */
function outcomeNote(d: Delivery | undefined): string {
  if (!d) return "The webhook was deleted."
  if (d.status === "delivered") return `Delivered: the URL answered HTTP ${d.lastStatus}.`
  if (!d.attempts) return "Still waiting to be sent. Check list_webhooks in a moment."
  const retry = d.status === "pending" ? ` Parley tries again at ${d.nextAttemptAt}.` : ""
  const auth = d.lastStatus === 401 || d.lastStatus === 403
    ? " The receiver refused who's calling: if its setup gave you a key, add it with update_webhook's headers (e.g. { \"Authorization\": \"Bearer <key>\" }), or put it in the URL as the setup shows."
    : ""
  return `Not delivered: ${d.lastError ?? "unknown error"}.${auth}${retry}`
}
const EVENTS_DOC = WEBHOOK_EVENTS.map((e) => `${e} (${EVENT_TEXT[e]})`).join("; ")

const FILE_LABEL: Record<string, string> = { audio: "voice-note", video: "video", document: "document", image: "photo", sticker: "sticker" }
const EXTENSIONS: Record<string, string> = {
  "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/wav": ".wav", "video/mp4": ".mp4", "video/quicktime": ".mov",
  "video/3gpp": ".3gp", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf", "application/zip": ".zip",
}
const extensionOf = (mimeType: string) => EXTENSIONS[mimeType] ?? ""
/** A file name safe to put in a shell command and on disk. */
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file"

/** A message as agents see it (read_inbox, load_history). */
function messageOut(m: StoredMessage) {
  return {
    id: m.id, from: m.fromMe ? "me" : m.sender, from_me: m.fromMe, text: m.text, at: m.at,
    ...(m.isNew ? { new: true } : {}),
    ...(m.media ? { media: { kind: m.media.kind, mimetype: m.media.mimetype, file_name: m.media.fileName ?? null, size: m.media.size ?? null, width: m.media.width ?? null, height: m.media.height ?? null, seconds: m.media.seconds ?? null } } : {}),
    ...(m.reactions.length ? { reactions: m.reactions.map((r) => ({ from: r.fromMe ? "me" : r.from, emoji: r.emoji, at: r.at, ...(r.isNew ? { new: true } : {}) })) } : {}),
  }
}

/** At most this many new reactions are listed in one answer; the rest stay new for the next read. */
const NEW_REACTIONS_LISTED = 100
/** Tools whose answer already has the full what's-new breakdown (the others get a short count). */
const FULL_VIEW_TOOLS = new Set(["list_chats", "read_inbox", "load_history", "get_notifications"])

const tally = (list: NewInChat[]) => ({
  chats: list.filter((c) => c.messages + c.reactions > 0).length,
  messages: list.reduce((n, c) => n + c.messages, 0),
  reactions: list.reduce((n, c) => n + c.reactions, 0),
})
/** What's new, split into the chat at hand (`this_chat`) and the rest (`other_chats`), or `all_chats` with none at hand. */
function splitNews(list: NewInChat[], here?: { chatId: string; connectionId?: string | undefined }) {
  if (!here) return { all_chats: tally(list) }
  const isHere = (c: NewInChat) => c.chatId === here.chatId && (!here.connectionId || c.connectionId === here.connectionId)
  const mine = list.filter(isHere)
  const { messages, reactions } = tally(mine)
  return { this_chat: { chat_id: here.chatId, name: mine[0]?.name ?? null, messages, reactions }, other_chats: tally(list.filter((c) => !isHere(c))) }
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

/** A search's words: each "quoted phrase" stays whole, everything else splits on spaces. */
export function searchWords(query: string): string[] {
  const words: string[] = []
  for (const [, phrase, word] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const w = (phrase ?? word ?? "").trim().replace(/\s+/g, " ")
    if (w && !words.includes(w)) words.push(w.slice(0, 100))
  }
  return words.slice(0, 10)
}
/** A query that is a phone number (or part of one, at least 3 digits): its digits, to find the chat it names. */
export const numberIn = (query: string) => (/^[\d\s+().-]+$/.test(query) && query.replace(/\D/g, "").length >= 3 ? query.replace(/\D/g, "") : undefined)
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** A search bound as an ISO time: a date alone is the start of that day (UTC), or with `end`, of the day after it. */
export function bound(value: string, end = false): string {
  if (!DAY.test(value)) return new Date(value).toISOString()
  const d = new Date(`${value}T00:00:00.000Z`)
  if (end) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
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

  // Every tool's answer says when something new came in (like a badge), so an agent busy sending or checking a message
  // still notices. Counted alongside the tool, never marks anything read, and left out when nothing is new or the count
  // fails. The reading tools give the full breakdown instead.
  // A tool about one chat (send_message, react_to_message, get_media, message_status, ...) splits it: this chat, and
  // the rest. Other tools give the total across all chats.
  type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> }
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
  const withNews = async (result: ToolResult, args: Record<string, unknown>, news: Promise<NewInChat[]>): Promise<ToolResult> => {
    const first = result.content?.[0]
    if (result.isError || first?.type !== "text" || !first.text) return result
    try {
      const body = JSON.parse(first.text)
      if (!body || typeof body !== "object" || Array.isArray(body)) return result
      const list = await news
      if (!list.some((c) => c.messages + c.reactions > 0)) return result
      // The chat the answer is about: as the answer names it (a send's `to` is the chat's own id), else as asked.
      const chatId = str(body.chat_id) ?? str(body.to) ?? str(args.chat_id) ?? str(args.to)
      const connectionId = str(body.connection_id) ?? (UUID.test(str(args.connection_id) ?? "") ? str(args.connection_id) : undefined)
      const badge = splitNews(list, chatId ? { chatId, connectionId } : undefined)
      return { ...result, content: [{ ...first, text: JSON.stringify({ ...body, new_since_last_read: badge }) }, ...result.content.slice(1)] }
    } catch {
      return result
    }
  }
  const register = server.registerTool.bind(server) as (name: string, config: unknown, cb: (...a: unknown[]) => Promise<ToolResult>) => unknown
  server.registerTool = ((name: string, config: unknown, cb: (...a: unknown[]) => Promise<ToolResult>) =>
    register(name, config, FULL_VIEW_TOOLS.has(name) ? cb : async (...a: unknown[]) => {
      const args = (a.length > 1 && a[0] && typeof a[0] === "object" ? a[0] : {}) as Record<string, unknown>
      const news = (async () => newByChat(ctx.sql, principalOf(a[a.length - 1] as Parameters<typeof principalOf>[0]).userId, { chatId: str(args.chat_id) ?? str(args.to) }))()
        .catch(() => [] as NewInChat[])
      return withNews(await cb(...a), args, news)
    })) as typeof server.registerTool

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
  const MARK_READ = z.boolean().optional().describe("Mark what this returns as read (default true). Pass false to look without changing what counts as new.")
  const READ_RECEIPTS = z.boolean().optional().describe(
    "Also mark the messages this returns read on WhatsApp itself, as opening the chat on the phone would. On by default whenever this marks them read (each number's setting in Parley); pass false to read without telling the sender. The senders see blue ticks only if that number's WhatsApp has read receipts on; otherwise only its own devices mark the chat read. On a number whose read receipts the account holder turned off in Parley, none are sent."
  )

  /**
   * Read receipts for what a read showed: sent when asked for, or by default when the read marks it read; per number,
   * and never on a number whose receipts the account holder turned off (an agent that asked is told). Best effort:
   * the read itself never fails over it; the answer says how many were marked, or why none were. Undefined when none
   * were wanted.
   */
  const receiptsFor = async (userId: string, asked: boolean | undefined, marking: boolean, messages: Array<{ connectionId: string; chatId: string; id: string; fromMe: boolean }>) => {
    if (!(asked ?? marking)) return undefined
    const result = await sendReceipts(userId, messages)
    // Only worth saying when something went out or went wrong, or to an agent that asked (and why none went).
    if (asked !== true) {
      delete result.off
      if (!result.marked && !result.error) return undefined
    }
    return result
  }

  const sendReceipts = async (userId: string, messages: Array<{ connectionId: string; chatId: string; id: string; fromMe: boolean }>) => {
    const byConn = new Map<string, Array<{ chatId: string; messageId: string }>>()
    for (const m of messages) {
      if (m.fromMe) continue
      if (!byConn.has(m.connectionId)) byConn.set(m.connectionId, [])
      byConn.get(m.connectionId)!.push({ chatId: m.chatId, messageId: m.id })
    }
    let marked = 0
    const errors: string[] = []
    const off: string[] = []
    for (const [connectionId, list] of byConn) {
      const conn = await getConnection(ctx.sql, connectionId)
      if (!conn || conn.accountId !== userId) continue
      if (!conn.readReceipts) {
        off.push(accountLabel(conn) ?? connectionId)
        continue
      }
      try {
        marked += (await ctx.sessions.sendReadReceipts(userId, connectionId, list)).marked
      } catch (e) {
        errors.push(known(e) ? (e as Error).message : "could not send read receipts")
      }
    }
    const out: { marked: number; error?: string; off?: string } = { marked }
    if (errors.length) out.error = [...new Set(errors)].join("; ")
    if (off.length) out.off = `The account holder turned read receipts off for ${off.join(", ")} in Parley, so none were sent there.`
    return out
  }

  /**
   * What came in since the chats in scope were last read: totals, per-chat counts, and the new reactions themselves
   * (a reaction to an old message wouldn't show up otherwise). Call before marking anything read.
   */
  const newSince = async (userId: string, where: InboxFilter, account: Map<string, string | null>) => {
    const [chats, reactions] = await Promise.all([
      ctx.sessions.inboxChats(userId, { ...where, onlyNew: true }),
      newReactions(ctx.sql, userId, { ...where, limit: NEW_REACTIONS_LISTED }),
    ])
    const messages = chats.reduce((n, c) => n + c.newMessages, 0)
    const reactionCount = chats.reduce((n, c) => n + c.newReactions, 0)
    const total = messages + reactionCount
    return {
      reactions,
      summary: {
        events: total, messages, reactions: reactionCount,
        text: total
          ? `${total} new since last read: ${plural(messages, "message")}, ${plural(reactionCount, "reaction")}${chats.length > 1 ? ` across ${chats.length} chats` : ""}.`
          : "Nothing new since last read.",
        chats: chats.map((c) => ({ connection_id: c.connectionId, account: account.get(c.connectionId) ?? null, chat_id: c.id, name: c.name, messages: c.newMessages, reactions: c.newReactions })),
      },
      newReactionsOut: reactions.map((r) => ({
        connection_id: r.connectionId, account: account.get(r.connectionId) ?? null, chat_id: r.chatId, chat_name: r.chatName,
        message_id: r.messageId, message_text: r.messageText, on_my_message: r.onMyMessage, from: r.from, emoji: r.emoji, at: r.at,
      })),
    }
  }

  /** Mark read what an answer showed: per chat, its newest shown message, and the new reactions listed. */
  const markShown = async (userId: string, messages: Array<StoredMessage & { connectionId: string }>, reactions: Array<{ connectionId: string; chatId: string; seq: number }>) => {
    const marks = new Map<string, { connectionId: string; chatId: string; messageSeq?: number; seenUntil?: string; reactionSeq?: number }>()
    const mark = (connectionId: string, chatId: string) => {
      const key = `${connectionId} ${chatId}`
      if (!marks.has(key)) marks.set(key, { connectionId, chatId })
      return marks.get(key)!
    }
    for (const m of messages) {
      const x = mark(m.connectionId, m.chatId)
      x.messageSeq = Math.max(x.messageSeq ?? 0, m.seq)
      if (!x.seenUntil || m.at > x.seenUntil) x.seenUntil = m.at
    }
    for (const r of reactions) {
      const x = mark(r.connectionId, r.chatId)
      x.reactionSeq = Math.max(x.reactionSeq ?? 0, r.seq)
    }
    await markRead(ctx.sql, userId, [...marks.values()])
  }

  server.registerTool(
    "read_inbox",
    {
      title: "Read inbox",
      description: "Read recent messages across all your connected accounts, newest first (each says which `account` it is on) — from every chat except ones the account holder ignored. Filter by channel, connection, or one chat (chat_id from list_chats). Page back with `before`. A message with `media` carries a photo, video, voice note, document or sticker (its `text` is the caption, or a placeholder like \"[photo]\"): call get_media to see it. `reactions` lists who reacted with what. `new_since_last_read` says how much came in from the other side since these chats were last read (messages and reactions, per chat); new messages and reactions carry `new: true`, and `new_reactions` lists every new reaction with the message it's on (even one on an old message not shown). Reading marks what it shows as read, for every agent on the account; pass mark_read: false to just look. Paging back with `before` never marks anything. Reading that marks read also sends read receipts on WhatsApp by default (blue ticks, if that number's WhatsApp has them on; the account holder can turn this off per number in Parley): pass read_receipts: false to read without telling the sender. Looking (mark_read: false) or paging back sends none unless read_receipts is true.",
      inputSchema: {
        ...filters,
        chat_id: z.string().optional().describe("Only this chat (a chat_id from list_chats or from an earlier message)."),
        limit: z.number().int().min(1).max(200).optional().describe("How many messages (default 50)."),
        before: z.string().datetime().optional().describe("Only messages sent before this ISO time — pass the `at` of the oldest message you have to page back."),
        mark_read: MARK_READ,
        read_receipts: READ_RECEIPTS,
      },
    },
    async ({ channel, connection_id, chat_id, limit, before, mark_read, read_receipts }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const where = { ...(await scope(userId, { channel, connection_id })), chatId: chat_id }
        const account = await labels(userId)
        const [messages, fresh] = await Promise.all([ctx.sessions.inbox(userId, { ...where, limit: limit ?? 50, before }), newSince(userId, where, account)])
        const shownNew = messages.filter((m) => m.isNew).length
        const out: Record<string, unknown> = {
          new_since_last_read: fresh.summary,
          messages: messages.map((m) => ({
            channel: m.channel, connection_id: m.connectionId, account: account.get(m.connectionId) ?? null, chat_id: m.chatId, chat_name: m.chatName, chat_kind: m.chatKind,
            ...messageOut(m),
          })),
          ...(fresh.newReactionsOut.length ? { new_reactions: fresh.newReactionsOut } : {}),
        }
        const marking = mark_read !== false && !before
        if (fresh.summary.messages > shownNew) {
          const unshown = fresh.summary.messages - shownNew
          out.more_new = before
            ? `${plural(unshown, "new message")} ${unshown === 1 ? "is" : "are"} outside this page.`
            : `${plural(unshown, "new message")} didn't fit in this answer${marking ? " (chats shown here still count as read up to their newest message)" : ""}: page back with \`before\`, raise \`limit\`, or read one chat with chat_id.`
        }
        if (marking) await markShown(userId, messages, fresh.reactions)
        const receipts = await receiptsFor(userId, read_receipts, marking, messages)
        if (receipts) out.read_receipts = receipts
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
      description: "List the chats (people and groups) agents can see (everything except what the account holder ignored), across all connected accounts, most recent first (the same person can appear once per account). `awaiting` says who owes the next message: \"you\" when the last word was theirs. `new` counts the messages and reactions from the other side since the chat was last read (read_inbox or load_history mark it read; listing doesn't). Set awaiting_reply to get just the conversations waiting on you, only_new for just the ones with something new.",
      inputSchema: {
        ...filters,
        awaiting_reply: z.boolean().optional().describe("Only chats whose last message came from the other side."),
        only_new: z.boolean().optional().describe("Only chats with new messages or reactions since they were last read."),
      },
    },
    async ({ channel, connection_id, awaiting_reply, only_new }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const [chats, account] = await Promise.all([ctx.sessions.inboxChats(userId, { ...(await scope(userId, { channel, connection_id })), awaitingReply: awaiting_reply, onlyNew: only_new }), labels(userId)])
        const messages = chats.reduce((n, c) => n + c.newMessages, 0)
        const reactions = chats.reduce((n, c) => n + c.newReactions, 0)
        const withNew = chats.filter((c) => c.newMessages + c.newReactions > 0).length
        return json({
          new_since_last_read: messages + reactions
            ? `${messages + reactions} new in ${plural(withNew, "chat")}: ${plural(messages, "message")}, ${plural(reactions, "reaction")}. read_inbox with a chat_id to read them.`
            : "Nothing new since last read.",
          chats: chats.map((c) => ({
            channel: c.channel, connection_id: c.connectionId, account: account.get(c.connectionId) ?? null, chat_id: c.id, name: c.name, kind: c.kind, last_message_at: c.lastMessageAt, awaiting: c.awaiting,
            new: { messages: c.newMessages, reactions: c.newReactions },
          })),
          ...(chats.length ? {} : { note: only_new ? "Nothing new since last read." : awaiting_reply ? "Nothing is waiting on you." : `No chats are visible. The account holder may have ignored them all; their chats are at ${pickUrl}` }),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not list chats")
      }
    }
  )

  const WHEN = z.union([z.string().date(), z.string().datetime({ offset: true })])
  server.registerTool(
    "search",
    {
      title: "Search chats and messages",
      description: "Search like WhatsApp's search bar, across all your connected accounts (or one, or one chat): `chats` whose name (or number) matches, and `messages` whose text matches, newest first. Every word in `query` must appear, in any order, case-insensitively and anywhere in a word (\"inv\" finds \"invoice\"); put a \"quoted phrase\" in quotes to keep it whole. A photo, video or document's caption counts as its text, and a document without one matches on its file name. Narrow it by date (`after`, `before`), by who sent it (`from_me`), to attachments (`media`), to messages with links (`links`), or to ones not yet read (`only_new`); filters work without a query too (e.g. every document in a chat last week). It searches what Parley has stored: everything in the chats the account holder didn't ignore since the account was linked, plus the history WhatsApp sent at linking and anything load_history fetched. Older messages that are only on the phone aren't found; load_history fetches a chat's older ones. Searching never marks anything read or sends read receipts. To read the conversation around a match, read_inbox with its chat_id and `before` (page back to it), or load_history.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Words to find (all of them must appear). \"Quoted phrases\" match whole. A phone number finds that person's chat."),
        ...filters,
        chat_id: z.string().optional().describe("Only in this chat (chat_id from list_chats or an earlier result)."),
        after: WHEN.optional().describe("Only messages sent on or after this: a date (\"2026-10-01\", that whole day included, UTC) or an ISO time."),
        before: WHEN.optional().describe("Only messages sent before this: a date (\"2026-10-31\", that whole day included, UTC) or an ISO time. To page back, pass the `at` of the oldest match you have."),
        from_me: z.boolean().optional().describe("true: only what the account holder sent. false: only what others sent. Omit for both."),
        media: z.enum(["any", "image", "video", "audio", "document", "sticker"]).optional().describe("Only messages with an attachment: \"any\", or one kind (image = photos, audio = voice notes and audio)."),
        links: z.boolean().optional().describe("Only messages with a link in them."),
        only_new: z.boolean().optional().describe("Only messages from the other side not yet read."),
        limit: z.number().int().min(1).max(100).optional().describe("How many messages (default 25)."),
      },
    },
    async ({ query, channel, connection_id, chat_id, after, before, from_me, media, links, only_new, limit }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const words = searchWords(query ?? "")
        if (!words.length && !after && !before && from_me === undefined && !media && !links && !only_new) {
          return fail("give a `query`, or a filter (after, before, from_me, media, links, only_new): with neither, read_inbox lists recent messages")
        }
        const from = after ? bound(after) : undefined
        const to = before ? bound(before, true) : undefined
        if (from && to && from >= to) return fail("`after` must be earlier than `before`")
        const where = { ...(await scope(userId, { channel, connection_id })), chatId: chat_id }
        const max = limit ?? 25
        const digits = query ? numberIn(query) : undefined
        const [messages, chats, account] = await Promise.all([
          ctx.sessions.inbox(userId, { ...where, limit: max, before: to, search: { words, after: from, media, links, fromMe: from_me, onlyNew: only_new } }),
          // Matching chats are only worth listing for a search across chats by words or number, as WhatsApp lists them.
          (words.length || digits) && !chat_id ? searchChats(ctx.sql, userId, { ...where, words, digits, limit: 20 }) : Promise.resolve([]),
          labels(userId),
        ])
        const oldest = messages.at(-1)?.at
        return json({
          ...(words.length || digits ? {
            chats: chats.map((c) => ({ channel: c.channel, connection_id: c.connectionId, account: account.get(c.connectionId) ?? null, chat_id: c.id, name: c.name, kind: c.kind, last_message_at: c.lastMessageAt })),
          } : {}),
          messages: messages.map((m) => ({
            channel: m.channel, connection_id: m.connectionId, account: account.get(m.connectionId) ?? null, chat_id: m.chatId, chat_name: m.chatName, chat_kind: m.chatKind,
            ...messageOut(m),
          })),
          ...(messages.length === max && oldest ? { more: `There may be more matches: search again with before: "${oldest}" for older ones.` } : {}),
          ...(!messages.length && !chats.length ? { note: "Nothing matched in the messages Parley has stored. Older messages may only be on the phone: try load_history on the chat once. If it can't fetch them, ask the account holder to export the chat from WhatsApp (in the chat: ⋮ → Export chat, on the phone or WhatsApp Web) and share the file." } : {}),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not search")
      }
    }
  )

  server.registerTool(
    "get_notifications",
    {
      title: "Get notifications",
      description: "What came in from the other side since chats were last read: totals (`all_chats`), and each chat with something new and how many messages and reactions. Pass chat_id to split it into that chat (`this_chat`) and the rest (`other_chats`). Never marks anything read; read_inbox with a chat_id reads one. Every other tool's answer carries the same totals as `new_since_last_read` when something is new.",
      inputSchema: { ...filters, chat_id: z.string().optional().describe("The chat you're in: counted on its own as this_chat, and left out of `chats`.") },
    },
    async ({ channel, connection_id, chat_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const where = await scope(userId, { channel, connection_id })
        const [list, account] = await Promise.all([newByChat(ctx.sql, userId, { ...where, chatId: chat_id }), labels(userId)])
        const here = chat_id ? { chatId: chat_id, connectionId: where.connectionId } : undefined
        const others = list.filter((c) => c.messages + c.reactions > 0 && !(here && c.chatId === here.chatId && (!here.connectionId || c.connectionId === here.connectionId)))
        return json({
          ...splitNews(list, here),
          chats: others.map((c) => ({ channel: c.channel, connection_id: c.connectionId, account: account.get(c.connectionId) ?? null, chat_id: c.chatId, name: c.name, kind: c.kind, messages: c.messages, reactions: c.reactions })),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not read notifications")
      }
    }
  )

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Queue a message on a connected channel: text, or a photo, video, GIF, voice note or document (pass `media`; `text` is then its caption). Parley sends at a human pace to keep the account safe: with gaps between sends, breaks after bursts, and a daily limit; if the person turned on active hours for the number, only inside its local active hours. The reply says when it will go out (scheduled_for) and why it isn't sooner (waits). Replies in existing conversations go ahead of conversation openers that hit their limit.",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account that has the \`to\` chat.`),
        to: z.string().describe("Recipient on the channel: a chat_id from list_chats, or a phone number for WhatsApp."),
        text: z.string().max(8000).optional().describe("The message, or the caption when sending media."),
        media: z.object({
          url: z.string().url().optional().describe("A public http(s) URL to download the file from."),
          data: z.string().optional().describe("Or the file itself, base64."),
          kind: z.enum(["image", "video", "audio", "document"]).optional().describe("How it shows in the chat. Defaults from the file type: JPEG/PNG/WebP photos and MP4 videos inline, GIFs as looping GIFs, audio as audio (OGG/Opus as a voice note), anything else as a document."),
          mimetype: z.string().max(200).optional().describe("The file's type, e.g. \"image/jpeg\". Defaults to what the URL serves, or the file name's extension."),
          file_name: z.string().max(200).optional().describe("Shown for documents."),
          gif: z.boolean().optional().describe("Send a video as a GIF: silent, looping, playing inline in the chat, like one picked from WhatsApp's GIF tab. A .gif file always goes this way (Parley converts it to the MP4 WhatsApp uses); set this for an MP4 GIF, e.g. a Giphy or Tenor .mp4 link."),
        }).optional().describe("A file to send: photos up to 16 MB; videos, audio and documents up to 100 MB from a url (16 MB as data). Give exactly one of url or data."),
        kind: z.enum(ACTIONS).optional().describe("What the send costs the account. Defaults to \"message\" in an existing conversation and \"first_message\" to someone new."),
        not_before: z.string().datetime().optional().describe("Don't send before this ISO time."),
        idempotency_key: z.string().min(1).max(200).optional().describe("Retrying with the same key returns the original message instead of sending twice."),
        typing: z.boolean().optional().describe("Show \"typing…\" in the chat first (\"recording…\" before a voice note), for about as long as a person would take: ~24s per 100 characters (50 words a minute), at most a minute, then send. On by default (the number's setting in Parley); pass false when it should just go. On a number whose typing the account holder turned off, it never shows."),
      },
    },
    async ({ connection_id, to, text, media, kind, not_before, idempotency_key, typing }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        if (!text && !media) return fail("give `text`, `media`, or both")
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: to })
        const file = media ? resolveMedia(media) : undefined
        const typingOn = conn.typing
        const showTyping = typingOn && typing !== false
        const { message, replayed } = await ctx.sessions.enqueue(userId, conn.id, {
          to, text: text ?? "", media: file, kind, notBefore: not_before ? new Date(not_before) : undefined, idempotencyKey: idempotency_key, agentSessionId: sessionId, typing: showTyping,
        })
        return json({
          ...queuedView(message, replayed), account: accountLabel(conn),
          ...(typing === true && !typingOn ? { typing_note: `The account holder turned typing off for ${accountLabel(conn) ?? "this number"} in Parley, so it sends without it.` } : {}),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not send")
      }
    }
  )

  server.registerTool(
    "load_history",
    {
      title: "Load a chat's history",
      description: "Fetch a chat's older messages from the account holder's phone, as WhatsApp's own \"get older messages from your phone\" does: the `count` messages before the oldest one Parley has (e.g. from before the account was linked, or while the chat was ignored), with their attachments and reactions. Call it again to go further back, `count` at a time. Waits up to about 20 seconds for the phone, which must be online; `answered` says whether it replied. Answered, it returns the older messages it fetched; not, the chat's latest messages as Parley has them. Afterwards they're in read_inbox too. Like read_inbox, it says what's new since the chat was last read (`new_since_last_read`, `new: true`, `new_reactions`; older history fetched now isn't new) and marks what it returns as read unless mark_read is false — and then, by default, sends read receipts on WhatsApp too (see read_receipts).",
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} Left out, it's the account that has the chat.`),
        chat_id: z.string().describe("The chat (chat_id from list_chats or read_inbox)."),
        count: z.number().int().min(1).max(50).optional().describe("How many older messages to fetch (default 20, at most 50)."),
        mark_read: MARK_READ,
        read_receipts: READ_RECEIPTS,
      },
    },
    async ({ connection_id, chat_id, count, mark_read, read_receipts }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id, { chatId: chat_id })
        const { answered, messages } = await ctx.sessions.loadHistory(userId, conn.id, chat_id, count ?? 20)
        const oldest = answered ? undefined : await historyAnchor(ctx.sql, conn.id, chat_id).catch(() => undefined)
        const account = new Map([[conn.id, accountLabel(conn)]])
        const fresh = await newSince(userId, { connectionId: conn.id, chatId: chat_id }, account)
        const shownNew = messages.filter((m) => m.isNew).length
        if (mark_read !== false) await markShown(userId, messages.map((m) => ({ ...m, connectionId: conn.id })), fresh.reactions)
        const receipts = await receiptsFor(userId, read_receipts, mark_read !== false, messages.map((m) => ({ ...m, connectionId: conn.id })))
        return json({
          account: accountLabel(conn), chat_id, answered, new_since_last_read: fresh.summary, messages: messages.map(messageOut),
          ...(receipts ? { read_receipts: receipts } : {}),
          ...(fresh.newReactionsOut.length ? { new_reactions: fresh.newReactionsOut } : {}),
          ...(fresh.summary.messages > shownNew ? { more_new: `${plural(fresh.summary.messages - shownNew, "new message")} didn't fit in \`count\`: read_inbox with this chat_id and a bigger limit shows them.` } : {}),
          ...(answered ? {} : {
            history_available: false,
            note: `Older history isn't available right now: the account holder's phone didn't send it (it may be offline, or WhatsApp on the phone may be declining history requests for a while; retrying soon rarely helps, so don't keep retrying). ${oldest ? `Parley's messages in this chat go back to ${oldest.at.slice(0, 10)}.` : ""} These are the latest messages Parley has. For anything older, tell the account holder Parley can't fetch it and ask them to export the chat from WhatsApp (in the chat: ⋮ → Export chat, on the phone or WhatsApp Web) and share the file.`.replace("  ", " "),
          }),
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
        "Open the photo, video, voice note, audio recording, document or sticker a message carries (a message from read_inbox with `media`). Photos and stickers come back as images you can see, and text files (txt, csv, json, …) as text. Voice notes, audio, videos, PDFs and other files up to 10 MB come back as the file itself, which your client saves to disk; videos also come with their preview frame. Every answer has a `download_url` (any size, valid for an hour) and a ready `save_with` curl command for saving the file yourself. Needs the connection online; an old file may take a moment while the sender's phone uploads it again.",
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
        const fileName = safeName(info.fileName || `${FILE_LABEL[info.kind] ?? info.kind}-${message_id}${extensionOf(mimeType)}`)
        const downloadUrl = `${base}/media/${link.token}`
        const about: Record<string, unknown> = {
          kind: info.kind, mimetype: info.mimetype, file_name: fileName, size: info.size ?? null,
          width: info.width ?? null, height: info.height ?? null, seconds: info.seconds ?? null,
          download_url: downloadUrl, download_expires_at: link.expiresAt,
          save_with: `curl -fsSL -o '${fileName}' '${downloadUrl}'`,
        }
        type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
        const parts: Part[] = []
        const fetchInline = async () => (await ctx.sessions.media(userId, conn.id, chat_id, message_id)).data
        // The file itself, as an embedded resource: clients save binary resources to disk and give the agent the path
        // (an `audio` block, by contrast, reaches some clients as a bare placeholder). Named, so the saved file is too.
        const asFile = async () => parts.push({ type: "resource", resource: { uri: `parley://media/${encodeURIComponent(fileName)}`, mimeType, blob: await fetchInline() } })
        if ((info.kind === "image" || info.kind === "sticker") && size <= INLINE_IMAGE_BYTES) {
          parts.push({ type: "image", data: await fetchInline(), mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg" })
        } else if (info.kind === "document" && TEXTUAL.test(mimeType) && size <= INLINE_TEXT_BYTES) {
          parts.push({ type: "text", text: new TextDecoder().decode(Uint8Array.from(atob(await fetchInline()), (ch) => ch.charCodeAt(0))) })
        } else {
          if (info.thumbnail) parts.push({ type: "image", data: info.thumbnail, mimeType: "image/jpeg" })
          if (size <= INLINE_FILE_BYTES) {
            await asFile()
            about.note = `The ${FILE_LABEL[info.kind] ?? "file"} is attached as a file${info.thumbnail ? " (the image is its preview)" : ""}. If your client didn't save it, run save_with.`
          } else {
            about.note = `Too big to attach (${Math.round(size / 1024 / 1024)} MB): save it with save_with${info.thumbnail ? "; the image is its preview" : ""}.`
          }
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
          sent_today: today.sentToday, daily_limit: today.dailyLimit, gap: sendGap(connection.channel, connection.gapSeconds),
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
    "set_send_gap",
    {
      title: "Set the gap between sends",
      description:
        `Set how long a connection waits between two sends: at least \`gap_seconds\`, up to twice that at random so it doesn't look scripted. 0 sends back to back; null goes back to the channel's default (WhatsApp 30–150s). Messages already queued are rescheduled on the new gap. A short gap makes the account look less human and raises the chance the platform restricts it, so change it only when the person asks. Openers to new contacts, breaks after bursts and the daily limit still apply.`,
      inputSchema: {
        connection_id: z.string().optional().describe(ACCOUNT_REF),
        gap_seconds: z.number().int().min(0).max(MAX_GAP_SECONDS).nullable().describe(`Least seconds between two sends, 0–${MAX_GAP_SECONDS}; null for the channel's default.`),
      },
    },
    async ({ connection_id, gap_seconds }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id)
        await ctx.sessions.setLocale(userId, conn.id, { gapSeconds: gap_seconds })
        const { connection } = await availability(ctx.sql, userId, conn.id, new Date())
        return json({ connection_id: conn.id, account: accountLabel(conn), gap: sendGap(connection.channel, connection.gapSeconds) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not set the gap")
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

  // ---- Webhooks ---------------------------------------------------------------------------------------------------

  /** Who an agent is, as a webhook it set up shows it on the dashboard. */
  const agentName = async (sessionId: string) => {
    const [r] = await ctx.sql<{ client_name: string | null }>(
      `select c.client_name from oauth.refresh_token r join oauth.client c using (client_id) where r.session_id = $1 limit 1`, [sessionId]
    ).catch(() => [])
    return `agent: ${r?.client_name || "an MCP client"}`
  }
  const eventsInput = z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional()

  server.registerTool(
    "list_webhooks",
    {
      title: "List webhooks",
      description: "Webhooks (URLs Parley calls the moment a message, reaction or deletion happens on a linked number). Each belongs to one number (`account`, `connection_id`). Lists each one's URL (keys in it masked), events, the headers it sends (names only), whether it's on, its last success and failure, and its latest deliveries (with include_payloads, the exact JSON body each sent: use it to debug a receiver). Also answers `payload_format`, what every request body looks like.",
      inputSchema: {
        connection_id: filters.connection_id,
        deliveries: z.number().int().min(0).max(50).optional().describe("How many recent deliveries to list per webhook (default 5)."),
        include_payloads: z.boolean().optional().describe("Include each delivery's JSON body (default false)."),
      },
    },
    async ({ connection_id, deliveries, include_payloads }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const conn = connection_id ? await findConnection(ctx, userId, connection_id) : undefined
        const [hooks, account] = await Promise.all([ctx.webhooks.list(ctx.sql, userId, { connectionId: conn?.id }), labels(userId)])
        const per = deliveries ?? 5
        const recent = await Promise.all(hooks.map((w) => (per ? ctx.webhooks.deliveries(ctx.sql, userId, { webhookId: w.id, limit: per }) : Promise.resolve([]))))
        return json({
          webhooks: hooks.map((w, i) => ({ ...webhookView(w, account.get(w.connectionId) ?? null), recent_deliveries: recent[i]!.map((d) => deliveryOut(d, { payload: include_payloads })) })),
          events: Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e, EVENT_TEXT[e]])),
          payload_format: PAYLOAD,
          ...(hooks.length ? {} : { note: "No webhooks yet. create_webhook adds one." }),
        })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not list webhooks")
      }
    }
  )

  server.registerTool(
    "create_webhook",
    {
      title: "Create a webhook",
      description: `Have Parley POST to a URL the moment something happens on one linked number, instead of polling read_inbox. Each webhook belongs to one number; add one per number to hear from several. Events: ${EVENTS_DOC}. Only real, live changes are sent: never history, backfills, or a message seen twice; chats the account holder ignored never send. Each request is a signed JSON POST: { id, type, created_at, sent_at, connection: { id, channel, account }, data }; for messages the text is at data.message.text (the answer's \`payload_format\` has every event's shape and an example: build the receiver from it). If the receiver checks who's calling with a key of its own (an Authorization header or API key its setup gave you), pass it in headers. The answer carries the signing secret: keep it, it isn't shown again (update_webhook with rotate_secret makes a new one). The account holder sees and can change every webhook on that number's page on the Parley dashboard. At most ${MAX_WEBHOOKS} per number.`,
      inputSchema: {
        connection_id: z.string().optional().describe(`${ACCOUNT_REF} The webhook hears only from this number.`),
        url: z.string().max(2000).describe(URL_DOC),
        events: eventsInput.describe("Which events to send. Default: all of them."),
        description: z.string().max(200).optional().describe("What it's for, shown on the dashboard."),
        headers: headersInput.describe(HEADERS_DOC),
      },
    },
    async ({ connection_id, url, events, description, headers }, extra) => {
      const { userId, sessionId } = principalOf(extra)
      try {
        const conn = await pickConnection(ctx, userId, connection_id)
        const { webhook, secret } = await ctx.webhooks.create(ctx.sql, userId, { connectionId: conn.id, url, events, description, headers: toHeaders(headers), createdBy: await agentName(sessionId) })
        return json({ ...webhookView(webhook, accountLabel(conn)), secret, verify: VERIFY, payload_format: PAYLOAD, next: "Call test_webhook with this id to send a test event and see that it arrives." })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not create the webhook")
      }
    }
  )

  server.registerTool(
    "update_webhook",
    {
      title: "Update a webhook",
      description: "Change a webhook's URL, events, description or headers, turn it off or back on, or replace its signing secret (rotate_secret: the old one stops working at once and the new one is in the answer). Turning it off drops what it still had waiting.",
      inputSchema: {
        webhook_id: z.string(),
        url: z.string().max(2000).optional().describe(`The new URL, whole. ${URL_DOC}`),
        events: eventsInput,
        description: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        rotate_secret: z.boolean().optional(),
        headers: headersInput.describe(`Replaces all of the webhook's own headers ({} removes them). ${HEADERS_DOC}`),
      },
    },
    async ({ webhook_id, url, events, description, enabled, rotate_secret, headers }, extra) => {
      const { userId } = principalOf(extra)
      try {
        let webhook = await ctx.webhooks.update(ctx.sql, userId, webhook_id, { url, events, description, enabled, headers: toHeaders(headers) })
        if (!rotate_secret) return json(webhookView(webhook))
        const rotated = await ctx.webhooks.rotateSecret(ctx.sql, userId, webhook_id)
        webhook = rotated.webhook
        return json({ ...webhookView(webhook), secret: rotated.secret, verify: VERIFY })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not update the webhook")
      }
    }
  )

  server.registerTool(
    "delete_webhook",
    { title: "Delete a webhook", description: "Remove a webhook. Nothing more is sent to it, including deliveries still waiting.", inputSchema: { webhook_id: z.string() } },
    async ({ webhook_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        await ctx.webhooks.remove(ctx.sql, userId, webhook_id)
        return json({ deleted: webhook_id })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not delete the webhook")
      }
    }
  )

  server.registerTool(
    "test_webhook",
    {
      title: "Test a webhook",
      description: "Send a webhook.test event to a webhook (signed like every other, and shaped like a message.received: the text is at data.message.text) and wait up to about 10 seconds to say whether it was delivered: the status the URL answered, or why it failed. A failed first attempt is retried like any delivery. The answer includes the exact payload sent.",
      inputSchema: { webhook_id: z.string() },
    },
    async ({ webhook_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const queued = await ctx.webhooks.test(ctx.sql, userId, webhook_id)
        // The sessions service sends it within a couple of seconds; wait for the first attempt's outcome.
        let d: Delivery | undefined = queued
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250))
          d = await ctx.webhooks.delivery(ctx.sql, userId, queued.id)
          if (!d || d.status === "delivered" || d.status === "failed" || (d.status === "pending" && d.attempts > 0)) break
        }
        return json({ ...deliveryOut(d ?? queued, { payload: true }), note: outcomeNote(d) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not test the webhook")
      }
    }
  )

  server.registerTool(
    "resend_webhook_delivery",
    {
      title: "Resend a webhook delivery",
      description: "Send a past delivery's event again (delivery ids are in list_webhooks), e.g. after fixing a receiver. It goes as a new delivery to the same webhook with the same body and event id (a receiver that dedupes on Parley-Event-Id sees a repeat; sent_at shows when this one went) and a fresh media download link. Waits up to about 10 seconds for the outcome. The webhook must be on (test events go either way).",
      inputSchema: { delivery_id: z.string() },
    },
    async ({ delivery_id }, extra) => {
      const { userId } = principalOf(extra)
      try {
        const queued = await ctx.webhooks.resend(ctx.sql, userId, delivery_id)
        let d: Delivery | undefined = queued
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250))
          d = await ctx.webhooks.delivery(ctx.sql, userId, queued.id)
          if (!d || d.status === "delivered" || d.status === "failed" || (d.status === "pending" && d.attempts > 0)) break
        }
        return json({ ...deliveryOut(d ?? queued), resent_from: delivery_id, note: outcomeNote(d) })
      } catch (e) {
        return fail(known(e) ? (e as Error).message : "could not resend the delivery")
      }
    }
  )

  return server
}
