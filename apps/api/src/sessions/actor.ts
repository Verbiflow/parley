import { SignInKey, serverSeal, secrets, type IdentityConfig, type Sql, type SecretSeal } from "@parley/auth"
import { SendFailure, channelById, type Channel, type ChannelEvent, type LinkMethod, type LiveConnection } from "@parley/channels"
import type { Outcome } from "@parley/pacing"
import { parsePhoneNumberFromString } from "libphonenumber-js"
import { Transactor } from "../db/transactor.ts"
import { Exits, ExitError } from "./exits.ts"
import { UNSEND_WINDOW_MS, abandon, claimDue, enqueue, expireLeases, replanConnection, report, setLocale, OutboxError, type Claimed, type EnqueueRequest, type Queued } from "./outbox.ts"
import { describeMedia, maxBytesFor, MediaInputError, type MediaSend } from "../mcp/media.ts"
import type { MediaFetcher } from "./fetch-media.ts"
import type { InboundMessage, MediaInfo } from "@parley/channels"
import { createConnection, getConnection, listConnections, connectedConnections, markConnected, setStatus, supersede, setHistorySync, type Connection, type Locale } from "./store.ts"
import { upsertChats, nameChats, mergeChats, touchChats, listChats, getChat, setSyncedChats, chatsChosen, saveMessages, saveReactions, forgetMessages, messageMedia, newestMessage, readMessages, inbox, inboxChats, type ChatRow, type StoredMessage, type InboxFilter, type InboxMessage, type InboxChat } from "./chats.ts"

const CREDS_KIND = "channel-creds" as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type Entry = {
  live: LiveConnection | undefined
  channel: string
  accountId: string
  link: { method: LinkMethod; data: string } | undefined
  loggingOut: boolean
  /** Events are applied one at a time, in order, so a message never lands before its chat row exists. */
  queue: Promise<void>
  /**
   * Until the person first picks chats, recent history is held here (not in the DB) so the chats they pick can be
   * backfilled. Dropped once they've chosen. Bounded per chat and in total.
   */
  history: Map<string, InboundMessage[]> | undefined
}

const HISTORY_PER_CHAT = 50
const HISTORY_CHATS = 300

export type StatusView = { status: string; channel: string; handle: string | null; link?: { method: LinkMethod; data: string } }
export type LinkView = { status: string; channel: string; link?: { method: LinkMethod; data: string } }
/** A message's attachment, fetched from the channel. `data` is base64 (it crosses the RPC wire as JSON). */
export type MediaFile = { data: string; mimetype: string; kind: string; fileName: string | null; size: number }
/** What a message's attachment is, without fetching it: kind, type, size, and its preview when there is one. */
export type MediaDetails = Omit<MediaInfo, "ref">
/** An attachment as a stream, for download links: any size, never held in memory whole. */
export type MediaStream = { body: ReadableStream<Uint8Array>; mimetype: string; kind: string; fileName: string | null }

/** The most messages load_history asks the phone for at once (WhatsApp's own page size). */
const HISTORY_MAX = 50
/** How long load_history waits for the phone; then, once the first of its messages land, for the rest of the batch. */
const HISTORY_WAIT_MS = 20_000
const HISTORY_SETTLE_MS = 2_000

/** The largest attachment fetched whole (to hand an agent inline). Bigger ones go through a download link. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024
const OUTBOUND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Read a stream whole, refusing past `max` bytes. */
export async function readAll(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > max) { await body.cancel().catch(() => {}); throw new ConnectError("not_found", `the attachment is over ${max / 1024 / 1024} MB; use its download link`) }
    chunks.push(chunk)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/**
 * What the HTTP app needs from the session pool. Two implementations: `Sessions` (the pool itself — runs where the
 * channel sockets live, the EC2 sessions service, and in-process locally/in tests) and `RemoteSessions` (the edge
 * Worker — reads Postgres directly, forwards live operations to the sessions service).
 */
export type SessionsApi = Pick<
  Sessions,
  | "connect" | "status" | "list" | "linkView" | "ensureLinking" | "send" | "logout" | "chats" | "chooseChats" | "messages" | "inbox" | "inboxChats"
  | "media" | "mediaInfo" | "mediaStream" | "loadHistory"
  | "enqueue" | "setLocale"
>

/**
 * The operations the sessions service exposes over RPC: anything touching a live socket, plus the outbox writes
 * (`enqueue`, `setLocale`) so pacing, its row locks and the dispatcher stay in one place. Everything else is a plain
 * Postgres read the edge does itself.
 */
export const LIVE_OPS = ["connect", "status", "linkView", "ensureLinking", "send", "logout", "chooseChats", "enqueue", "setLocale", "media", "loadHistory"] as const
export type LiveOp = (typeof LIVE_OPS)[number]

/**
 * Cross-worker coordinator: tracks which worker holds each connection and routes commands to it. Optional — without
 * one, the pool is single-process (fine for one box). `RedisCoordinator` implements this.
 */
export interface Coordinator {
  readonly workerId: string
  start(handler: (req: { connId: string; op: string; args: Record<string, unknown> }) => Promise<unknown>): Promise<void>
  claim(connId: string): Promise<void>
  release(connId: string): Promise<void>
  ownerOf(connId: string): Promise<string | undefined>
  callOwner(owner: string, req: { connId: string; op: string; args: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

type ConnectErrorCode = "unknown_channel" | "not_found" | "forbidden" | "not_connected" | "not_synced" | "no_exit"

export class ConnectError extends Error {
  readonly code: ConnectErrorCode
  constructor(code: ConnectErrorCode, message: string) {
    super(message)
    this.name = "ConnectError"
    this.code = code
  }
}

/**
 * The session pool: holds every account's live channel connections in memory and is the one place the channel event
 * stream becomes persistent state. Channel-agnostic — it dispatches to `channelById(ctx.channels, …)`. With a
 * `coordinator`, a fleet of workers shares the role: each connection is held by one worker and commands route to it.
 */
/** How often a worker looks for due messages on the connections it holds. */
export const DISPATCH_INTERVAL_MS = 3_000

type SessionsContext = {
  sql: Sql; channels: Channel[]; config: IdentityConfig; coordinator?: Coordinator; tx?: Transactor; exits?: Exits
  /** Downloads a URL an agent asked to send (see `fetch-media.ts`). Without one, files must come as bytes. */
  fetchMedia?: MediaFetcher
}

export class Sessions {
  readonly #live = new Map<string, Entry>()
  /** load_history calls waiting for a chat's older messages to arrive, by connection + chat. */
  readonly #arrivals = new Map<string, Set<(at: number) => void>>()
  #seal: SecretSeal | undefined
  #dispatcher: ReturnType<typeof setInterval> | undefined
  #dispatching: Promise<number> | undefined
  /** Connections with a send in flight (it may be showing "typing…" for a while), and its chain. */
  #sending = new Map<string, Promise<void>>()
  readonly tx: Transactor
  readonly exits: Exits
  private readonly ctx: SessionsContext

  constructor(ctx: SessionsContext) {
    this.ctx = ctx
    if (!ctx.tx && !ctx.config.databaseUrl) throw new Error("Sessions needs DATABASE_URL (or a Transactor) for the outbox")
    this.tx = ctx.tx ?? new Transactor(ctx.config.databaseUrl!)
    this.exits = ctx.exits ?? new Exits(ctx.config)
  }

  /** Start coordination (no-op without a coordinator) and the dispatcher. Call once before serving. */
  async start(): Promise<void> {
    await this.ctx.coordinator?.start((req) => this.#handleRpc(req))
    this.#dispatcher = setInterval(() => void this.dispatchDue().catch(() => {}), DISPATCH_INTERVAL_MS)
    this.#dispatcher.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.#dispatcher)
    await this.#dispatching?.catch(() => {})
    await Promise.all(this.#sending.values())
    for (const entry of this.#live.values()) await entry.live?.close().catch(() => {})
    this.#live.clear()
    await this.tx.close()
  }

  async connect(accountId: string, channelId: string, locale: Locale = {}): Promise<{ connectionId: string; channel: string; linkMethod: LinkMethod }> {
    const channel = channelById(this.ctx.channels, channelId)
    if (!channel) throw new ConnectError("unknown_channel", `no channel "${channelId}"`)
    const conn = await createConnection(this.ctx.sql, accountId, channelId, locale)
    await this.#open(channel, conn.id, accountId, undefined)
    return { connectionId: conn.id, channel: channelId, linkMethod: channel.capabilities.linkMethod }
  }

  /**
   * Queue a message for this connection's next human-paced slot. Whichever worker holds the connection sends it then;
   * the caller gets back when that will be and why it isn't sooner.
   */
  async enqueue(
    accountId: string, connectionId: string,
    request: Omit<EnqueueRequest, "accountId" | "connectionId" | "media"> & { media?: MediaSend | undefined },
    now?: Date
  ): Promise<{ message: Queued; replayed: boolean }> {
    const at = now ?? new Date()
    let req: Omit<EnqueueRequest, "accountId" | "connectionId"> = { ...request, media: undefined }
    if (request.media) {
      const conn = await getConnection(this.ctx.sql, connectionId)
      if (!conn || conn.accountId !== accountId) throw new OutboxError(conn ? "forbidden" : "not_found", conn ? "not your connection" : "no such connection")
      const channel = channelById(this.ctx.channels, conn.channel)
      if (channel && !channel.capabilities.media) throw new OutboxError("action_unsupported", `${channel.id} can't send files`)
      req = { ...req, media: await this.#fileToSend(request.media) }
    }
    if (req.reactTo) {
      const [found] = await this.ctx.sql<{ yes: boolean }>(
        `select true as yes from parley.message m join parley.connection k on k.id = m.connection_id
          where m.connection_id = $1 and k.account_id = $2 and m.chat_id = $3 and m.id = $4`,
        [connectionId, accountId, req.to, req.reactTo]
      )
      if (!found) throw new OutboxError("not_found", "no such message in that chat (use a message id from read_inbox)")
    }
    if (req.unsend) req = { ...req, ...(await this.#unsendTarget(accountId, connectionId, req.to, req.unsend, at)), text: "" }
    const queued = await enqueue(this.tx, { accountId, connectionId, ...req }, at)
    // Due now on a connection held here: send without waiting for the next pass. (Not for a caller-supplied clock.)
    if (!now && queued.message.scheduledFor && Date.parse(queued.message.scheduledFor) <= at.getTime() && this.#live.has(connectionId)) {
      setImmediate(() => void this.dispatchDue().catch(() => {}))
    }
    return queued
  }

  async setLocale(accountId: string, connectionId: string, locale: Locale, now = new Date()): Promise<void> {
    await setLocale(this.tx, accountId, connectionId, locale, now)
  }

  /**
   * Send what's due on the connections this worker holds, one message per connection per pass, and feed each result
   * back into pacing. Lapsed leases (a worker that died mid-send) fail here too. Passes never overlap.
   */
  async dispatchDue(now?: Date): Promise<number> {
    if (this.#dispatching) return this.#dispatching
    let started: Promise<void>[] = []
    // Only claiming is exclusive. The sends themselves run in the background, one chain per connection, so an account
    // showing "typing…" for up to a minute holds up nobody else: the next pass claims for every connection that
    // isn't mid-send. The returned promise still settles once this pass's own sends are done.
    this.#dispatching = (async () => {
      const at = now ?? new Date()
      await expireLeases(this.tx, at)
      const ids = [...this.#live].filter(([id, e]) => e.live && !e.loggingOut && !this.#sending.has(id)).map(([id]) => id)
      const jobs = await claimDue(this.tx, ids, at)
      const byConnection = new Map<string, Claimed[]>()
      for (const job of jobs) byConnection.set(job.connectionId, [...(byConnection.get(job.connectionId) ?? []), job])
      started = [...byConnection].map(([connectionId, queue]) => {
        const run = (async () => {
          for (const job of queue) await this.#deliver(job, now)
        })().catch((e) => console.error(JSON.stringify({ msg: "delivery failed", connectionId, error: e instanceof Error ? e.message : String(e) })))
          .finally(() => this.#sending.delete(connectionId))
        this.#sending.set(connectionId, run)
        return run
      })
      return jobs.length
    })().finally(() => {
      this.#dispatching = undefined
    })
    const count = await this.#dispatching
    await Promise.all(started)
    return count
  }

  async #deliver(job: Claimed, now: Date | undefined): Promise<void> {
    const entry = this.#live.get(job.connectionId)
    let result: { outcome: Outcome; externalId?: string; detail?: string }
    try {
      if (!entry?.live) throw new SendFailure("transport_error", "connection went offline before the send")
      if (job.unsend) {
        // It may have waited in the queue (a paused account) past the point the platform still honours it.
        const sentAt = await this.#sentAt(job.connectionId, job.chatId, job.unsend)
        if (sentAt && sentAt.getTime() + UNSEND_WINDOW_MS <= (now ?? new Date()).getTime()) {
          await abandon(this.tx, job.id, "too_late", "it waited past the time the message could still be deleted for everyone", now ?? new Date())
          return
        }
      }
      const sent = await entry.live.send(job.chatId, {
        text: job.text, media: job.media,
        react: job.reactTo ? await this.#reactTarget(job.connectionId, job.chatId, job.reactTo) : undefined,
        unsend: job.unsend ? { messageId: job.unsend, fromMe: true } : undefined,
        typing: job.typing,
      })
      result = { outcome: "sent", externalId: sent.id }
    } catch (e) {
      result = { outcome: e instanceof SendFailure ? e.outcome : "transport_error", detail: e instanceof Error ? e.message : String(e) }
    }
    await report(this.tx, job.id, result, now ?? new Date())
    // Gone for everyone, so gone here too (the platform's own notice of it may come later, or not at all).
    if (job.unsend && result.outcome === "sent") await forgetMessages(this.ctx.sql, job.connectionId, [{ threadId: job.chatId, messageId: job.unsend }]).catch(() => {})

    const exitId = await this.exits.liveExitId(this.ctx.sql, job.connectionId)
    if (!exitId) return
    if (result.outcome === "transport_error") {
      await this.exits.recordFailure(this.tx, exitId)
      // Retired for failing: reopen the socket so it picks up a fresh exit.
      if (!(await this.exits.liveExitId(this.ctx.sql, job.connectionId)) && entry) {
        this.#live.delete(job.connectionId)
        await entry.live?.close().catch(() => {})
        await this.ctx.coordinator?.release(job.connectionId)
        await this.#hydrate(job.connectionId).catch(() => {})
      }
    } else if (result.outcome === "banned") {
      await this.exits.burn(this.ctx.sql, exitId)
    } else {
      await this.exits.recordSuccess(this.ctx.sql, exitId)
    }
  }

  /** The bytes to queue: as given, or downloaded now from the agent's URL (so a bad link fails the call, not the send). */
  async #fileToSend(media: MediaSend): Promise<NonNullable<EnqueueRequest["media"]>> {
    try {
      if (!("url" in media)) return describeMedia(media)
      if (!this.ctx.fetchMedia) throw new MediaInputError("this server can't download files; send the file as `data`")
      const got = await this.ctx.fetchMedia(media.url, maxBytesFor(media.kind))
      return describeMedia({ data: got.data, kind: media.kind, mimetype: media.mimetype, served: got.contentType, fileName: media.fileName ?? got.fileName })
    } catch (e) {
      // Over the wire as an outbox refusal, so the agent sees why.
      if (e instanceof MediaInputError) throw new OutboxError("action_unsupported", e.message)
      throw e
    }
  }

  /**
   * The message a deletion takes back, as the channel knows it: given as the id send_message returned (a message sent
   * through Parley) or a message id from read_inbox (one the account sent, from Parley or its phone). Only the
   * account's own messages, within the platform's window, and not one already being deleted.
   */
  async #unsendTarget(accountId: string, connectionId: string, chatId: string, id: string, now: Date): Promise<{ to: string; unsend: string; unsendBefore: Date }> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn || conn.accountId !== accountId) throw new OutboxError(conn ? "forbidden" : "not_found", conn ? "not your connection" : "no such connection")
    const channel = channelById(this.ctx.channels, conn.channel)
    if (channel && !channel.capabilities.unsend) throw new OutboxError("action_unsupported", `${channel.id} can't delete sent messages`)
    let target: { chatId: string; messageId: string; sentAt: Date }
    if (OUTBOUND_ID.test(id)) {
      const [o] = await this.ctx.sql<{ chat_id: string; status: string; external_id: string | null; sent_at: Date | null; react_to: string | null; unsend: string | null }>(
        `select chat_id, status, external_id, sent_at, react_to, unsend from parley.outbound where id = $1 and connection_id = $2`, [id, connectionId]
      )
      if (!o) throw new OutboxError("not_found", "no such message on this account")
      if (o.react_to || o.unsend) throw new OutboxError("action_unsupported", o.react_to ? "that's a reaction; take it back with react_to_message and an empty emoji" : "that's a deletion, not a message")
      if (o.status === "scheduled") throw new OutboxError("not_cancelable", "it hasn't gone out yet; cancel it with cancel_message instead")
      if (o.status !== "sent" || !o.external_id || !o.sent_at) throw new OutboxError("not_found", `the message is ${o.status}, so there's nothing to delete`)
      target = { chatId: o.chat_id, messageId: o.external_id, sentAt: o.sent_at }
    } else {
      const [m] = await this.ctx.sql<{ from_me: boolean; sent_at: Date }>(
        `select from_me, sent_at from parley.message where connection_id = $1 and chat_id = $2 and id = $3`, [connectionId, chatId, id]
      )
      if (!m) throw new OutboxError("not_found", "no such message in that chat (use a message id from read_inbox, or the id send_message returned)")
      if (!m.from_me) throw new OutboxError("forbidden", "only messages the account sent can be deleted for everyone")
      target = { chatId, messageId: id, sentAt: m.sent_at }
    }
    const unsendBefore = new Date(target.sentAt.getTime() + UNSEND_WINDOW_MS)
    if (unsendBefore <= now) throw new OutboxError("too_late", `it was sent at ${target.sentAt.toISOString()}; messages can only be deleted for everyone for about two days`)
    const [pending] = await this.ctx.sql<{ id: string }>(
      `select id from parley.outbound where connection_id = $1 and chat_id = $2 and unsend = $3 and status in ('scheduled', 'sending', 'sent') limit 1`,
      [connectionId, target.chatId, target.messageId]
    )
    if (pending) throw new OutboxError("not_cancelable", `that message is already being deleted (${pending.id})`)
    return { to: target.chatId, unsend: target.messageId, unsendBefore }
  }

  /** When the account sent a message it's deleting, from what's stored; undefined if neither copy is left. */
  async #sentAt(connectionId: string, chatId: string, messageId: string): Promise<Date | undefined> {
    const [r] = await this.ctx.sql<{ at: Date | null }>(
      `select coalesce(
         (select sent_at from parley.message where connection_id = $1 and chat_id = $2 and id = $3),
         (select sent_at from parley.outbound where connection_id = $1 and chat_id = $2 and external_id = $3 and status = 'sent' order by sent_at limit 1)) as at`,
      [connectionId, chatId, messageId]
    )
    return r?.at ?? undefined
  }

  /** Who sent the message a reaction is for: the channel needs it to address the reaction. */
  async #reactTarget(connectionId: string, chatId: string, messageId: string): Promise<{ messageId: string; fromMe: boolean; sender?: string }> {
    const [m] = await this.ctx.sql<{ from_me: boolean; sender: string }>(`select from_me, sender from parley.message where connection_id = $1 and chat_id = $2 and id = $3`, [connectionId, chatId, messageId])
    return m ? { messageId, fromMe: m.from_me, sender: m.sender } : { messageId, fromMe: false }
  }

  /**
   * Fetch a stored message's attachment from the channel (it isn't kept here). Only from a synced chat, like reading;
   * it needs the connection live, since the file comes down through the account's own session.
   */
  async media(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaFile> {
    const info = await this.#attachment(accountId, connectionId, chatId, messageId)
    if ((info.size ?? 0) > MAX_MEDIA_BYTES) throw new ConnectError("not_found", `the attachment is ${Math.round(info.size! / 1024 / 1024)} MB; use its download link`)
    const routed = await this.#route(connectionId, { op: "media", args: { ref: info.ref } })
    const file = routed.ok ? (routed.result as { data: string; mimetype: string }) : await this.#localMedia(connectionId, info.ref)
    return { ...file, kind: info.kind, fileName: info.fileName ?? null, size: Buffer.from(file.data, "base64").byteLength }
  }

  /**
   * The last `count` messages of a chat, fetched from the account holder's phone: ones Parley never stored (before it
   * was linked, or that failed to decrypt) are added, ones it has are filled in (attachments, reactions). Asks for the
   * messages before the newest one stored, waits for the phone's answer (it must be online), and returns the chat's
   * last `count` messages either way, with `answered` saying whether the phone replied in time.
   */
  async loadHistory(accountId: string, connectionId: string, chatId: string, count: number): Promise<{ answered: boolean; messages: StoredMessage[] }> {
    await this.#owned(accountId, connectionId)
    const chat = await getChat(this.ctx.sql, connectionId, chatId)
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — it doesn't exist, or the account holder ignored it")
    const n = Math.max(1, Math.min(HISTORY_MAX, Math.floor(count)))
    const routed = await this.#route(connectionId, { op: "loadHistory", args: { chatId, count: n } })
    if (routed.ok) return routed.result as { answered: boolean; messages: StoredMessage[] }
    return this.#localLoadHistory(connectionId, chatId, n)
  }

  async #localLoadHistory(connectionId: string, chatId: string, n: number): Promise<{ answered: boolean; messages: StoredMessage[] }> {
    let entry = this.#live.get(connectionId)
    if (!entry?.live) entry = await this.#hydrate(connectionId)
    if (!entry?.live) throw new ConnectError("not_connected", "connection is not live")
    if (!entry.live.backfill) throw new ConnectError("not_found", "this channel can't fetch history")
    const anchor = await newestMessage(this.ctx.sql, connectionId, chatId)
    if (!anchor) throw new ConnectError("not_found", "Parley has no message in this chat yet to fetch history back from; it can once one arrives")
    const before = Date.parse(anchor.at)
    const key = `${connectionId}\n${chatId}`
    // Resolves once older messages for this chat land (plus a moment for the rest of the batch), or on timeout.
    let stop!: (answered: boolean) => void
    const answered = new Promise<boolean>((resolve) => {
      let settling: ReturnType<typeof setTimeout> | undefined
      const listeners = this.#arrivals.get(key) ?? new Set()
      this.#arrivals.set(key, listeners)
      const onArrive = (at: number) => { if (at < before && !settling) settling = setTimeout(() => stop(true), HISTORY_SETTLE_MS) }
      const timer = setTimeout(() => stop(false), HISTORY_WAIT_MS)
      stop = (ok) => {
        clearTimeout(timer)
        if (settling) clearTimeout(settling)
        listeners.delete(onArrive)
        if (!listeners.size) this.#arrivals.delete(key)
        resolve(ok)
      }
      listeners.add(onArrive)
    })
    try {
      // The newest stored message is one of the `n`; ask for the rest before it.
      await entry.live.backfill({ threadId: chatId, ...anchor }, Math.max(1, n - 1))
    } catch (e) {
      stop(false)
      throw e
    }
    return { answered: await answered, messages: await readMessages(this.ctx.sql, connectionId, chatId, { limit: n }) }
  }

  /** What a message's attachment is, from the database alone (no download). */
  async mediaInfo(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaDetails> {
    const { ref: _ref, ...details } = await this.#attachment(accountId, connectionId, chatId, messageId)
    return details
  }

  /** The attachment as a stream, for a download link. Same checks as `media`, no size cap. */
  async mediaStream(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaStream> {
    const info = await this.#attachment(accountId, connectionId, chatId, messageId)
    const about = { kind: info.kind, fileName: info.fileName ?? null }
    // Held by another worker: it hands the file over whole (the RPC is JSON), then it's streamed from here.
    const routed = await this.#route(connectionId, { op: "media", args: { ref: info.ref } })
    if (routed.ok) {
      const file = routed.result as { data: string; mimetype: string }
      return { ...about, mimetype: file.mimetype, body: new Blob([Buffer.from(file.data, "base64")]).stream() }
    }
    const file = await this.#liveMedia(connectionId, info.ref)
    return { ...about, mimetype: info.mimetype ?? file.mimetype, body: file.body }
  }

  async #attachment(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaInfo> {
    await this.#owned(accountId, connectionId)
    const chat = await getChat(this.ctx.sql, connectionId, chatId)
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — it doesn't exist, or the account holder ignored it")
    const info = await messageMedia(this.ctx.sql, connectionId, chatId, messageId)
    if (!info) throw new ConnectError("not_found", "that message has no attachment Parley can fetch")
    return info
  }

  async #liveMedia(connectionId: string, ref: string): Promise<{ body: ReadableStream<Uint8Array>; mimetype: string }> {
    let entry = this.#live.get(connectionId)
    if (!entry?.live) entry = await this.#hydrate(connectionId)
    if (!entry?.live) throw new ConnectError("not_connected", "connection is not live")
    if (!entry.live.media) throw new ConnectError("not_found", "this channel can't fetch attachments")
    return entry.live.media(ref)
  }

  async #localMedia(connectionId: string, ref: string): Promise<{ data: string; mimetype: string }> {
    const file = await this.#liveMedia(connectionId, ref)
    return { data: Buffer.from(await readAll(file.body, MAX_MEDIA_BYTES)).toString("base64"), mimetype: file.mimetype }
  }

  async status(accountId: string, connectionId: string): Promise<StatusView> {
    const conn = await this.#owned(accountId, connectionId)
    const routed = await this.#route(connectionId, { op: "status", args: {} })
    if (routed.ok) return routed.result as StatusView
    return { status: conn.status, channel: conn.channel, handle: conn.handle, link: this.#live.get(connectionId)?.link }
  }

  async list(accountId: string): Promise<Connection[]> {
    return listConnections(this.ctx.sql, accountId)
  }

  /** What the link page shows — no account check (the unguessable id is the capability). Routes to the owner. */
  async linkView(connectionId: string): Promise<LinkView> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn) throw new ConnectError("not_found", "no such connection")
    const routed = await this.#route(connectionId, { op: "linkView", args: {} })
    if (routed.ok) return routed.result as LinkView
    return { status: conn.status, channel: conn.channel, link: this.#live.get(connectionId)?.link }
  }

  /**
   * Make sure a connection that isn't connected is actively arming a QR. Opening the link page calls this, so a
   * connection left in `linking`/`closed` — e.g. after a server restart dropped its socket — gets a fresh QR instead
   * of waiting forever. No-op if it's already live on this worker, owned elsewhere, or already connected.
   */
  async ensureLinking(connectionId: string): Promise<void> {
    if (this.#live.has(connectionId)) return
    const conn = await getConnection(this.ctx.sql, connectionId)
    // Only a link that's still pending (or was dropped mid-link) re-arms; a disconnected one stays disconnected.
    if (!conn || (conn.status !== "linking" && conn.status !== "closed")) return
    if (this.ctx.coordinator && (await this.ctx.coordinator.ownerOf(connectionId))) return
    const channel = channelById(this.ctx.channels, conn.channel)
    if (!channel) return
    await setStatus(this.ctx.sql, connectionId, "linking")
    await this.#open(channel, connectionId, conn.accountId, undefined)
  }

  async send(accountId: string, connectionId: string, to: string, text: string): Promise<{ id: string }> {
    await this.#owned(accountId, connectionId)
    const routed = await this.#route(connectionId, { op: "send", args: { to, text } })
    if (routed.ok) return routed.result as { id: string }
    let entry = this.#live.get(connectionId)
    if (!entry?.live) entry = await this.#hydrate(connectionId)
    if (!entry?.live) throw new ConnectError("not_connected", "connection is not live")
    return entry.live.send(to, { text })
  }

  async logout(accountId: string, connectionId: string): Promise<void> {
    await this.#owned(accountId, connectionId)
    const routed = await this.#route(connectionId, { op: "logout", args: {} })
    if (routed.ok) return
    await this.#localLogout(connectionId)
  }

  /** Every chat on the connection (for the person choosing what to sync), or only synced ones (what agents see). */
  async chats(accountId: string, connectionId: string, opts: { syncedOnly?: boolean } = {}): Promise<ChatRow[]> {
    await this.#owned(accountId, connectionId)
    return listChats(this.ctx.sql, connectionId, opts)
  }

  /** Set exactly which chats are synced. Newly synced chats are backfilled from held history; un-synced ones are wiped. */
  async chooseChats(accountId: string, connectionId: string, chatIds: string[]): Promise<void> {
    await this.#owned(accountId, connectionId)
    const turnedOn = await setSyncedChats(this.ctx.sql, connectionId, chatIds)
    const routed = await this.#route(connectionId, { op: "flushHistory", args: { chatIds: turnedOn } })
    if (!routed.ok) await this.#flushHistory(connectionId, turnedOn)
  }

  /** Recent messages in a synced chat, oldest first. An unsynced chat reads as not found — agents can't see it. */
  async messages(accountId: string, connectionId: string, chatId: string, opts: { limit: number; before?: string | undefined }): Promise<{ chat: ChatRow; messages: StoredMessage[] }> {
    await this.#owned(accountId, connectionId)
    const chat = await getChat(this.ctx.sql, connectionId, chatId)
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — it doesn't exist, or the account holder ignored it")
    return { chat, messages: await readMessages(this.ctx.sql, connectionId, chatId, opts) }
  }

  /** Messages across all the account's synced chats on connected channels, newest first (see `inbox`). */
  async inbox(accountId: string, opts: InboxFilter & { limit: number; before?: string | undefined }): Promise<InboxMessage[]> {
    if (opts.connectionId) await this.#owned(accountId, opts.connectionId)
    return inbox(this.ctx.sql, accountId, opts)
  }

  async inboxChats(accountId: string, opts: InboxFilter = {}): Promise<InboxChat[]> {
    if (opts.connectionId) await this.#owned(accountId, opts.connectionId)
    return inboxChats(this.ctx.sql, accountId, opts)
  }

  /** On boot, re-open live connections this worker will own (those nobody else holds). */
  async hydrateAll(): Promise<number> {
    const conns = await connectedConnections(this.ctx.sql)
    let n = 0
    for (const conn of conns) {
      if (this.ctx.coordinator && (await this.ctx.coordinator.ownerOf(conn.id))) continue
      if (await this.#hydrate(conn.id)) n++
    }
    return n
  }

  // --- routing ---------------------------------------------------------------

  /** If another worker owns this connection, run the op there. Returns {ok:false} to mean "handle locally". */
  async #route(connectionId: string, req: { op: string; args: Record<string, unknown> }): Promise<{ ok: true; result: unknown } | { ok: false }> {
    if (this.#live.has(connectionId) || !this.ctx.coordinator) return { ok: false }
    const owner = await this.ctx.coordinator.ownerOf(connectionId)
    if (!owner || owner === this.ctx.coordinator.workerId) return { ok: false }
    return { ok: true, result: await this.ctx.coordinator.callOwner(owner, { connId: connectionId, op: req.op, args: req.args }) }
  }

  async #handleRpc(req: { connId: string; op: string; args: Record<string, unknown> }): Promise<unknown> {
    const { connId, op, args } = req
    const conn = await getConnection(this.ctx.sql, connId)
    const entry = this.#live.get(connId)
    switch (op) {
      case "status":
        return { status: conn?.status ?? "unknown", channel: conn?.channel ?? "", handle: conn?.handle ?? null, link: entry?.link } satisfies StatusView
      case "linkView":
        return { status: conn?.status ?? "unknown", channel: conn?.channel ?? "", link: entry?.link } satisfies LinkView
      case "send":
        if (!entry?.live) throw new ConnectError("not_connected", "connection is not live")
        return entry.live.send(String(args.to), { text: String(args.text) })
      case "logout":
        await this.#localLogout(connId)
        return null
      case "media":
        return this.#localMedia(connId, String(args.ref))
      case "loadHistory":
        return this.#localLoadHistory(connId, String(args.chatId), Number(args.count))
      case "flushHistory":
        await this.#flushHistory(connId, (args.chatIds as string[]) ?? [])
        return null
      default:
        throw new Error(`unknown op ${op}`)
    }
  }

  // --- internals -------------------------------------------------------------

  async #seal_(): Promise<SecretSeal> {
    return (this.#seal ??= serverSeal(await SignInKey.from(this.ctx.config.signInKey)))
  }

  async #owned(accountId: string, connectionId: string): Promise<Connection> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn) throw new ConnectError("not_found", "no such connection")
    if (conn.accountId !== accountId) throw new ConnectError("forbidden", "not your connection")
    return conn
  }

  async #open(channel: Channel, connectionId: string, accountId: string, state: string | undefined): Promise<Entry> {
    const chosen = await chatsChosen(this.ctx.sql, connectionId)
    const entry: Entry = { live: undefined, channel: channel.id, accountId, link: undefined, loggingOut: false, queue: Promise.resolve(), history: chosen ? undefined : new Map() }
    const conn = await getConnection(this.ctx.sql, connectionId)
    let proxy: string | undefined
    try {
      proxy = conn ? (await this.exits.exitFor(this.tx, { id: connectionId, accountId, channel: channel.id, country: conn.country }))?.url : undefined
    } catch (e) {
      if (e instanceof ExitError) throw new ConnectError("no_exit", e.message)
      throw e
    }
    this.#live.set(connectionId, entry)
    const emit = (event: ChannelEvent) => {
      entry.queue = entry.queue.then(() => this.#onEvent(connectionId, event)).catch((e: unknown) => {
        // One bad event mustn't stall the connection, but it mustn't vanish silently either.
        console.error(JSON.stringify({ msg: "session event failed", connectionId, event: event.type, error: e instanceof Error ? e.message : String(e) }))
      })
    }
    const live = await channel.open({ connectionId, state, proxy, emit })
    entry.live = live
    await this.ctx.coordinator?.claim(connectionId)
    return entry
  }

  async #onEvent(connectionId: string, event: ChannelEvent): Promise<void> {
    const entry = this.#live.get(connectionId)
    if (!entry) return
    switch (event.type) {
      case "link":
        entry.link = { method: event.method, data: event.data }
        break
      case "open":
        entry.link = undefined
        await markConnected(this.ctx.sql, connectionId, event.handle, countryOf(event.handle))
        await replanConnection(this.tx, connectionId, new Date())
        // Linking a number that's already linked replaces the older link: two live links to one phone would read
        // every message twice. Signing the old one out (off this event queue) also removes it from the phone.
        for (const old of await supersede(this.ctx.sql, connectionId)) {
          void this.logout(entry.accountId, old).catch((e: unknown) =>
            console.error(JSON.stringify({ msg: "retire superseded link failed", connectionId: old, error: e instanceof Error ? e.message : String(e) })))
        }
        break
      case "state":
        await this.#saveCreds(entry.accountId, entry.channel, connectionId, event.state)
        break
      case "chats":
        await upsertChats(this.ctx.sql, connectionId, event.chats)
        break
      case "names":
        await nameChats(this.ctx.sql, connectionId, event.names)
        break
      case "merge":
        await mergeChats(this.ctx.sql, connectionId, event.pairs)
        break
      case "sync":
        await setHistorySync(this.ctx.sql, connectionId, event.progress, event.done)
        break
      case "message":
      case "messages": {
        const ms = event.type === "message" ? [event.message] : event.messages
        await touchChats(this.ctx.sql, connectionId, ms.map((m) => ({ id: m.threadId, at: m.at })))
        await saveMessages(this.ctx.sql, connectionId, ms)
        if (entry.history) for (const m of ms) this.#hold(entry.history, m)
        // A load_history waiting on this chat hears that (older) messages arrived.
        for (const m of ms) for (const fn of this.#arrivals.get(`${connectionId}\n${m.threadId}`) ?? []) fn(Date.parse(m.at))
        break
      }
      case "reactions":
        await saveReactions(this.ctx.sql, connectionId, event.reactions)
        break
      case "deleted":
        await forgetMessages(this.ctx.sql, connectionId, event.messages)
        break
      case "closed":
        await setStatus(this.ctx.sql, connectionId, entry.loggingOut ? "logged_out" : "closed")
        this.#live.delete(connectionId)
        await this.ctx.coordinator?.release(connectionId)
        break
    }
  }

  #hold(history: Map<string, InboundMessage[]>, m: InboundMessage): void {
    let list = history.get(m.threadId)
    if (!list) {
      if (history.size >= HISTORY_CHATS) return
      history.set(m.threadId, (list = []))
    }
    list.push(m)
    if (list.length > HISTORY_PER_CHAT) list.splice(0, list.length - HISTORY_PER_CHAT)
  }

  /** Write held history for the newly synced chats, then stop holding history (the person has made their choice). */
  async #flushHistory(connectionId: string, chatIds: string[]): Promise<void> {
    const entry = this.#live.get(connectionId)
    if (!entry?.history) return
    const held = chatIds.flatMap((id) => entry.history!.get(id) ?? [])
    entry.history = undefined
    await saveMessages(this.ctx.sql, connectionId, held)
  }

  async #localLogout(connectionId: string): Promise<void> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    const entry = this.#live.get(connectionId) ?? (await this.#hydrate(connectionId))
    if (entry) entry.loggingOut = true
    await entry?.live?.logout().catch(() => {})
    if (conn) await this.#forgetCreds(conn.accountId, conn.channel, connectionId)
    await setStatus(this.ctx.sql, connectionId, "logged_out")
    this.#live.delete(connectionId)
    await this.ctx.coordinator?.release(connectionId)
  }

  async #saveCreds(accountId: string, channel: string, connectionId: string, state: string): Promise<void> {
    const seal = await this.#seal_()
    const version = crypto.randomUUID()
    const bytes = encoder.encode(state)
    const sealed = await seal.seal({ userId: accountId, kind: CREDS_KIND, purpose: channel, name: connectionId, version }, bytes)
    await secrets.saveSecret(this.ctx.sql, { userId: accountId, kind: CREDS_KIND, purpose: channel, name: connectionId, version, bytes: bytes.length, ...sealed })
  }

  async #forgetCreds(accountId: string, channel: string, connectionId: string): Promise<void> {
    await secrets.removeSecrets(this.ctx.sql, { userId: accountId, kind: CREDS_KIND, purpose: channel }, connectionId)
  }

  async #hydrate(connectionId: string): Promise<Entry | undefined> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn || conn.status !== "connected") return undefined
    const channel = channelById(this.ctx.channels, conn.channel)
    if (!channel) return undefined
    const read = await secrets.readSecret(this.ctx.sql, { userId: conn.accountId, kind: CREDS_KIND, purpose: conn.channel }, connectionId)
    if (!read) return undefined
    const seal = await this.#seal_()
    const bytes = await seal.open({ userId: conn.accountId, kind: CREDS_KIND, purpose: conn.channel, name: connectionId, version: read.version }, read)
    if (!bytes) return undefined
    return this.#open(channel, connectionId, conn.accountId, decoder.decode(bytes))
  }
}

/** The country of a phone-number handle (a WhatsApp JID), so pacing and exits follow where the account lives. */
function countryOf(handle: string): string | undefined {
  const digits = handle.split("@")[0]!.split(":")[0]!.replace(/\D/g, "")
  return digits ? parsePhoneNumberFromString(`+${digits}`)?.country : undefined
}
