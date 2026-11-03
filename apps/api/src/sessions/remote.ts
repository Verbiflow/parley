import type { Sql } from "@parley/auth/db"
import type { LinkMethod } from "@parley/channels"
import { ConnectError, type LiveOp, type SessionsApi, type StatusView, type LinkView } from "./actor.ts"
import { getConnection, listConnections, type Connection } from "./store.ts"
import { listChats, getChat, readMessages, inbox, inboxChats, type ChatRow, type StoredMessage, type InboxFilter, type InboxMessage, type InboxChat } from "./chats.ts"

const CONNECT_ERRORS = new Set(["unknown_channel", "not_found", "forbidden", "not_connected", "not_synced"])
const RPC_TIMEOUT_MS = 20_000

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

  connect(accountId: string, channelId: string): Promise<{ connectionId: string; channel: string; linkMethod: LinkMethod }> {
    return this.#call("connect", [accountId, channelId])
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
    if (!chat?.synced) throw new ConnectError("not_synced", "no such synced chat — the account holder chooses which chats are synced")
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

  async #call<T>(op: LiveOp, args: unknown[]): Promise<T> {
    const { fetch, baseUrl, secret } = this.#transport
    const res = await fetch(`${baseUrl}/rpc/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ args }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => undefined)) as { result?: T; error?: { code: string; message: string } } | undefined
    if (res.ok && body && "result" in body) return body.result as T
    const err = body?.error
    if (err && CONNECT_ERRORS.has(err.code)) throw new ConnectError(err.code as ConstructorParameters<typeof ConnectError>[0], err.message)
    throw new Error(`sessions service ${op} failed: ${res.status} ${err?.code ?? ""}`.trim())
  }
}
