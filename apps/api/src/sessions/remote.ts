import type { Sql } from "@parley/auth/db"
import type { LinkMethod } from "@parley/channels"
import { ConnectError, type LiveOp, type MediaDetails, type MediaFile, type MediaStream, type Sessions, type SessionsApi, type StatusView, type LinkView } from "./actor.ts"
import { OutboxError, type Queued } from "./outbox.ts"
import { getConnection, listConnections, type Connection, type Locale } from "./store.ts"
import { listChats, getChat, readMessages, inbox, inboxChats, messageMedia, type ChatRow, type StoredMessage, type InboxFilter, type InboxMessage, type InboxChat } from "./chats.ts"

const CONNECT_ERRORS = new Set(["unknown_channel", "not_found", "forbidden", "not_connected", "not_synced", "no_exit"])
type EnqueueRequest = Parameters<Sessions["enqueue"]>[2]
const RPC_TIMEOUT_MS = 20_000
/** A download can wait on the sender's phone re-uploading an expired file. */
const MEDIA_TIMEOUT_MS = 60_000
/** Sending from a URL: the sessions service downloads up to 100 MB first. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/** Base64 without Node's Buffer (this runs on the edge). */
function base64(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

/** How the edge reaches the sessions service: a `fetch` (the Workers VPC binding's, in production) plus the shared secret. */
export type SessionsTransport = { fetch: (input: string, init: RequestInit) => Promise<Response>; baseUrl: string; secret: string }

/**
 * The session pool as seen from the edge Worker. Reads (connections, chats, messages, inbox) go straight to Postgres
 * — through Hyperdrive — with the same ownership checks as `Sessions`. Anything that touches a live socket (connect,
 * link status, send, logout, choosing chats) is forwarded to the sessions service, which holds the sockets.
 *
 * Edge-safe: no Node-only imports, no Redis, no Baileys.
 */
export class RemoteSessions implements SessionsApi {
  readonly #sql: Sql
  readonly #transport: SessionsTransport

  constructor(sql: Sql, transport: SessionsTransport) {
    this.#sql = sql
    this.#transport = transport
  }

  connect(accountId: string, channelId: string, locale: Locale = {}): Promise<{ connectionId: string; channel: string; linkMethod: LinkMethod }> {
    return this.#call("connect", [accountId, channelId, locale])
  }
  /** `now` isn't forwarded: the sessions service's clock decides pacing. */
  enqueue(accountId: string, connectionId: string, req: EnqueueRequest): Promise<{ message: Queued; replayed: boolean }> {
    const media = req.media && ("data" in req.media ? { ...req.media, data: base64(req.media.data) } : req.media)
    // A URL is downloaded by the sessions service before it answers: give it time.
    return this.#call("enqueue", [accountId, connectionId, { ...req, notBefore: req.notBefore?.toISOString(), media }], media && "url" in media ? DOWNLOAD_TIMEOUT_MS : RPC_TIMEOUT_MS)
  }
  async mediaInfo(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaDetails> {
    await this.#owned(accountId, connectionId)
    const chat = await getChat(this.#sql, connectionId, chatId)
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — it doesn't exist, or the account holder ignored it")
    const info = await messageMedia(this.#sql, connectionId, chatId, messageId)
    if (!info) throw new ConnectError("not_found", "that message has no attachment Parley can fetch")
    const { ref: _ref, ...details } = info
    return details
  }
  /** Streamed straight through from the sessions service: the edge never holds the whole file. */
  async mediaStream(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaStream> {
    const { fetch, baseUrl, secret } = this.#transport
    // The timeout covers getting started (the phone may have to re-upload), not the transfer: a big video streams for a while.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), MEDIA_TIMEOUT_MS)
    const res = await fetch(`${baseUrl}/rpc-stream/media`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ args: [accountId, connectionId, chatId, messageId] }),
      signal: abort.signal,
    }).finally(() => clearTimeout(timer))
    if (!res.ok || !res.body) {
      const err = ((await res.json().catch(() => undefined)) as { error?: { code: string; message: string } } | undefined)?.error
      if (err && CONNECT_ERRORS.has(err.code)) throw new ConnectError(err.code as ConstructorParameters<typeof ConnectError>[0], err.message)
      throw new Error(`sessions service mediaStream failed: ${res.status}`)
    }
    const about = JSON.parse(res.headers.get("x-parley-media") ?? "{}") as { mimetype?: string; kind?: string; fileName?: string | null }
    return { body: res.body, mimetype: about.mimetype ?? "application/octet-stream", kind: about.kind ?? "document", fileName: about.fileName ?? null }
  }
  /** Fetching an attachment needs the live socket, so it runs on the sessions service. */
  media(accountId: string, connectionId: string, chatId: string, messageId: string): Promise<MediaFile> {
    return this.#call("media", [accountId, connectionId, chatId, messageId], MEDIA_TIMEOUT_MS)
  }
  setLocale(accountId: string, connectionId: string, locale: Locale): Promise<void> {
    return this.#call("setLocale", [accountId, connectionId, locale])
  }
  status(accountId: string, connectionId: string): Promise<StatusView> {
    return this.#call("status", [accountId, connectionId])
  }
  linkView(connectionId: string): Promise<LinkView> {
    return this.#call("linkView", [connectionId])
  }
  ensureLinking(connectionId: string): Promise<void> {
    return this.#call("ensureLinking", [connectionId])
  }
  send(accountId: string, connectionId: string, to: string, text: string): Promise<{ id: string }> {
    return this.#call("send", [accountId, connectionId, to, text])
  }
  logout(accountId: string, connectionId: string): Promise<void> {
    return this.#call("logout", [accountId, connectionId])
  }
  chooseChats(accountId: string, connectionId: string, chatIds: string[]): Promise<void> {
    return this.#call("chooseChats", [accountId, connectionId, chatIds])
  }

  async list(accountId: string): Promise<Connection[]> {
    return listConnections(this.#sql, accountId)
  }

  async chats(accountId: string, connectionId: string, opts: { syncedOnly?: boolean } = {}): Promise<ChatRow[]> {
    await this.#owned(accountId, connectionId)
    return listChats(this.#sql, connectionId, opts)
  }

  async messages(accountId: string, connectionId: string, chatId: string, opts: { limit: number; before?: string | undefined }): Promise<{ chat: ChatRow; messages: StoredMessage[] }> {
    await this.#owned(accountId, connectionId)
    const chat = await getChat(this.#sql, connectionId, chatId)
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — it doesn't exist, or the account holder ignored it")
    return { chat, messages: await readMessages(this.#sql, connectionId, chatId, opts) }
  }

  async inbox(accountId: string, opts: InboxFilter & { limit: number; before?: string | undefined }): Promise<InboxMessage[]> {
    if (opts.connectionId) await this.#owned(accountId, opts.connectionId)
    return inbox(this.#sql, accountId, opts)
  }

  async inboxChats(accountId: string, opts: InboxFilter = {}): Promise<InboxChat[]> {
    if (opts.connectionId) await this.#owned(accountId, opts.connectionId)
    return inboxChats(this.#sql, accountId, opts)
  }

  async #owned(accountId: string, connectionId: string): Promise<Connection> {
    const conn = await getConnection(this.#sql, connectionId)
    if (!conn) throw new ConnectError("not_found", "no such connection")
    if (conn.accountId !== accountId) throw new ConnectError("forbidden", "not your connection")
    return conn
  }

  async #call<T>(op: LiveOp, args: unknown[], timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
    const { fetch, baseUrl, secret } = this.#transport
    const res = await fetch(`${baseUrl}/rpc/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ args }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json().catch(() => undefined)) as { result?: T; error?: { type?: string; code: string; message: string } } | undefined
    if (res.ok && body && "result" in body) return body.result as T
    const err = body?.error
    if (err?.type === "OutboxError") throw new OutboxError(err.code as OutboxError["code"], err.message)
    if (err && CONNECT_ERRORS.has(err.code)) throw new ConnectError(err.code as ConstructorParameters<typeof ConnectError>[0], err.message)
    throw new Error(`sessions service ${op} failed: ${res.status} ${err?.code ?? ""}`.trim())
  }
}
