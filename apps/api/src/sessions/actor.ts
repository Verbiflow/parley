import { SignInKey, serverSeal, secrets, type IdentityConfig, type Sql, type SecretSeal } from "@parley/auth"
import { channelById, type Channel, type ChannelEvent, type LinkMethod, type LiveConnection } from "@parley/channels"
import type { InboundMessage } from "@parley/channels"
import { createConnection, getConnection, listConnections, connectedConnections, markConnected, setStatus, type Connection } from "./store.ts"
import { upsertChats, touchChat, listChats, getChat, setSyncedChats, chatsChosen, saveMessages, readMessages, inbox, inboxChats, type ChatRow, type StoredMessage, type InboxFilter, type InboxMessage, type InboxChat } from "./chats.ts"

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

/**
 * What the HTTP app needs from the session pool. Two implementations: `Sessions` (the pool itself — runs where the
 * channel sockets live, the EC2 sessions service, and in-process locally/in tests) and `RemoteSessions` (the edge
 * Worker — reads Postgres directly, forwards live operations to the sessions service).
 */
export type SessionsApi = Pick<
  Sessions,
  "connect" | "status" | "list" | "linkView" | "ensureLinking" | "send" | "logout" | "chats" | "chooseChats" | "messages" | "inbox" | "inboxChats"
>

/** The live operations the sessions service exposes over RPC (everything else is a plain Postgres read). */
export const LIVE_OPS = ["connect", "status", "linkView", "ensureLinking", "send", "logout", "chooseChats"] as const
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

export class ConnectError extends Error {
  readonly code: "unknown_channel" | "not_found" | "forbidden" | "not_connected" | "not_synced"
  constructor(code: "unknown_channel" | "not_found" | "forbidden" | "not_connected" | "not_synced", message: string) {
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
export class Sessions {
  readonly #live = new Map<string, Entry>()
  #seal: SecretSeal | undefined
  private readonly ctx: { sql: Sql; channels: Channel[]; config: IdentityConfig; coordinator?: Coordinator }

  constructor(ctx: { sql: Sql; channels: Channel[]; config: IdentityConfig; coordinator?: Coordinator }) {
    this.ctx = ctx
  }

  /** Start coordination (no-op without a coordinator). Call once before serving. */
  async start(): Promise<void> {
    await this.ctx.coordinator?.start((req) => this.#handleRpc(req))
  }

  async connect(accountId: string, channelId: string): Promise<{ connectionId: string; channel: string; linkMethod: LinkMethod }> {
    const channel = channelById(this.ctx.channels, channelId)
    if (!channel) throw new ConnectError("unknown_channel", `no channel "${channelId}"`)
    const conn = await createConnection(this.ctx.sql, accountId, channelId)
    await this.#open(channel, conn.id, accountId, undefined)
    return { connectionId: conn.id, channel: channelId, linkMethod: channel.capabilities.linkMethod }
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
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — the account holder chooses which chats are synced")
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
    this.#live.set(connectionId, entry)
    const emit = (event: ChannelEvent) => {
      entry.queue = entry.queue.then(() => this.#onEvent(connectionId, event)).catch(() => {})
    }
    const live = await channel.open({ connectionId, state, emit })
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
        await markConnected(this.ctx.sql, connectionId, event.handle)
        break
      case "state":
        await this.#saveCreds(entry.accountId, entry.channel, connectionId, event.state)
        break
      case "chats":
        await upsertChats(this.ctx.sql, connectionId, event.chats)
        break
      case "message": {
        const m = event.message
        await touchChat(this.ctx.sql, connectionId, m.threadId, m.at)
        await saveMessages(this.ctx.sql, connectionId, [m])
        if (entry.history) this.#hold(entry.history, m)
        break
      }
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
