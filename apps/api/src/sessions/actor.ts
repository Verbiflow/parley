import { SignInKey, serverSeal, secrets, type IdentityConfig, type Sql, type SecretSeal } from "@parley/auth"
import { channelById, type Channel, type ChannelEvent, type LinkMethod, type LiveConnection } from "@parley/channels"
import { createConnection, getConnection, listConnections, connectedConnections, markConnected, setStatus, type Connection } from "./store.ts"

const CREDS_KIND = "channel-creds" as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type Entry = {
  live: LiveConnection | undefined
  channel: string
  accountId: string
  link: { method: LinkMethod; data: string } | undefined
  loggingOut: boolean
}

export class ConnectError extends Error {
  readonly code: "unknown_channel" | "not_found" | "forbidden" | "not_connected"
  constructor(code: "unknown_channel" | "not_found" | "forbidden" | "not_connected", message: string) {
    super(message)
    this.name = "ConnectError"
    this.code = code
  }
}

/**
 * The session pool: it holds every account's live channel connections in memory and is the one place the channel
 * event stream is turned into persistent state. Channel-agnostic — it dispatches to `channelById(ctx.channels, …)`
 * and knows nothing about WhatsApp specifically. (Phase 4 is a single in-process pool; the Redis registry that lets a
 * fleet of workers share this role is the next phase.)
 */
export class Sessions {
  readonly #live = new Map<string, Entry>()
  #seal: SecretSeal | undefined
  private readonly ctx: { sql: Sql; channels: Channel[]; config: IdentityConfig }

  constructor(ctx: { sql: Sql; channels: Channel[]; config: IdentityConfig }) {
    this.ctx = ctx
  }

  async #seal_(): Promise<SecretSeal> {
    return (this.#seal ??= serverSeal(await SignInKey.from(this.ctx.config.signInKey)))
  }

  /** Start linking a new connection. Returns its id and how the user links it; the link material arrives via events. */
  async connect(accountId: string, channelId: string): Promise<{ connectionId: string; channel: string; linkMethod: LinkMethod }> {
    const channel = channelById(this.ctx.channels, channelId)
    if (!channel) throw new ConnectError("unknown_channel", `no channel "${channelId}"`)
    const conn = await createConnection(this.ctx.sql, accountId, channelId)
    await this.#open(channel, conn.id, accountId, undefined)
    return { connectionId: conn.id, channel: channelId, linkMethod: channel.capabilities.linkMethod }
  }

  /** The current state of a connection, including live link material while it's being linked. */
  async status(accountId: string, connectionId: string): Promise<{ status: string; channel: string; handle: string | null; link?: { method: LinkMethod; data: string } }> {
    const conn = await this.#owned(accountId, connectionId)
    const entry = this.#live.get(connectionId)
    return { status: conn.status, channel: conn.channel, handle: conn.handle, link: entry?.link }
  }

  async list(accountId: string): Promise<Connection[]> {
    return listConnections(this.ctx.sql, accountId)
  }

  /**
   * What the link page shows — no account check, since the person linking may not have a browser session yet. The
   * unguessable connection id is the capability (like a one-time link). Returns the live link material while linking.
   */
  async linkView(connectionId: string): Promise<{ status: string; channel: string; link?: { method: LinkMethod; data: string } }> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn) throw new ConnectError("not_found", "no such connection")
    const entry = this.#live.get(connectionId)
    return { status: conn.status, channel: conn.channel, link: entry?.link }
  }

  /** Send a message on a connected connection; hydrates the socket from stored creds if this worker didn't hold it. */
  async send(accountId: string, connectionId: string, to: string, text: string): Promise<{ id: string }> {
    await this.#owned(accountId, connectionId)
    let entry = this.#live.get(connectionId)
    if (!entry?.live) entry = await this.#hydrate(connectionId)
    if (!entry?.live) throw new ConnectError("not_connected", "connection is not live")
    return entry.live.send(to, { text })
  }

  /** Unlink on the channel and forget the sealed creds. */
  async logout(accountId: string, connectionId: string): Promise<void> {
    const conn = await this.#owned(accountId, connectionId)
    const entry = this.#live.get(connectionId) ?? (await this.#hydrate(connectionId))
    if (entry) entry.loggingOut = true
    await entry?.live?.logout().catch(() => {})
    await this.#forgetCreds(conn.accountId, conn.channel, connectionId)
    await setStatus(this.ctx.sql, connectionId, "logged_out")
    this.#live.delete(connectionId)
  }

  /** On boot, re-open every live connection from its sealed creds so sockets survive a restart. */
  async hydrateAll(): Promise<number> {
    const conns = await connectedConnections(this.ctx.sql)
    let n = 0
    for (const conn of conns) if (await this.#hydrate(conn.id)) n++
    return n
  }

  // --- internals -------------------------------------------------------------

  async #owned(accountId: string, connectionId: string): Promise<Connection> {
    const conn = await getConnection(this.ctx.sql, connectionId)
    if (!conn) throw new ConnectError("not_found", "no such connection")
    if (conn.accountId !== accountId) throw new ConnectError("forbidden", "not your connection")
    return conn
  }

  async #open(channel: Channel, connectionId: string, accountId: string, state: string | undefined): Promise<Entry> {
    const entry: Entry = { live: undefined, channel: channel.id, accountId, link: undefined, loggingOut: false }
    this.#live.set(connectionId, entry)
    const live = await channel.open({ connectionId, state, emit: (event) => void this.#onEvent(connectionId, event).catch(() => {}) })
    entry.live = live
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
      case "message":
        // Inbound storage + delivery (webhooks/events) is the messages phase; nothing to do yet.
        break
      case "closed":
        await setStatus(this.ctx.sql, connectionId, entry.loggingOut ? "logged_out" : "closed")
        this.#live.delete(connectionId)
        break
    }
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
