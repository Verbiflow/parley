import { SignInKey, serverSeal, type IdentityConfig, type SecretSeal, type Sql } from "@parley/auth"
import { isPrivateHost } from "../mcp/media.ts"
import { accountLabel } from "../mcp/accounts.ts"
import { signMediaLink } from "../media-link.ts"

/**
 * Webhooks: URLs that hear, as it happens, about new messages, reactions and deletions on one connection (one linked
 * number; each number has its own). This half is edge-safe (the dashboard and MCP on the Worker use it): registering, listing, changing and
 * removing webhooks, their sealed signing secrets, and queueing events. Sending happens on the sessions service
 * (`webhook-delivery.ts`), which holds the network checks a request needs before it leaves.
 *
 * Only what really changed is sent: a message stored for the first time, a reaction whose emoji changed, a stored
 * message deleted for everyone; and only as it happens (`live` channel events), never history or backfills.
 */

export const WEBHOOK_EVENTS = ["message.received", "message.sent", "reaction.added", "reaction.removed", "message.deleted"] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
/** What each event means, for the dashboard and the MCP tool descriptions. */
export const EVENT_TEXT: Record<WebhookEvent, string> = {
  "message.received": "a message came in from someone else",
  "message.sent": "the account sent a message (from its phone, or through Parley)",
  "reaction.added": "someone (or the account) reacted to a message, or changed their reaction",
  "reaction.removed": "someone (or the account) took their reaction back",
  "message.deleted": "a message was deleted for everyone",
}
/** The event a test delivery carries. Always sent, whatever the webhook subscribes to. */
export const TEST_EVENT = "webhook.test"

/** The most webhooks one connection (number) can have. */
export const MAX_WEBHOOKS = 10
/** The most headers of its own a webhook can send. */
export const MAX_WEBHOOK_HEADERS = 10
/** Attempts per delivery: the first, then two retries. */
export const MAX_ATTEMPTS = 3
/** How long to wait before the second and third attempts. */
export const RETRY_DELAYS_MS = [30_000, 5 * 60_000] as const
/** How long delivered and failed deliveries are kept, to show on the dashboard and in list_webhooks. */
export const DELIVERY_RETENTION_DAYS = 7

export class WebhookError extends Error {
  readonly code: "invalid" | "not_found" | "limit"
  constructor(code: WebhookError["code"], message: string) {
    super(message)
    this.name = "WebhookError"
    this.code = code
  }
}

export type DeliveryStatus = "pending" | "sending" | "delivered" | "failed"
export type Delivery = {
  id: string; webhookId: string; eventId: string; event: string; status: DeliveryStatus; attempts: number
  nextAttemptAt: string | null; lastStatus: number | null; lastError: string | null; createdAt: string; deliveredAt: string | null
  /** The JSON body it sends (the same on every attempt). */
  payload: unknown
}
export type Webhook = {
  id: string; connectionId: string; url: string; events: WebhookEvent[]; description: string | null; enabled: boolean; createdBy: string
  /** The secret's last few characters, so a person can tell which one their receiver has. */
  secretHint: string
  /** Headers of its own it sends on every request (e.g. the receiver's `Authorization`): names, and a hint of each value. */
  headers: WebhookHeader[]
  lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null
  createdAt: string; updatedAt: string
}
/** A header the webhook sends, as shown back: its name and the value's last few characters (empty for a short value). */
export type WebhookHeader = { name: string; hint: string }
/** A header to set: `value: null` (editing only) keeps the value it already has under that name. */
export type WebhookHeaderInput = { name: string; value: string | null }

type Row = {
  id: string; account_id: string; connection_id: string; url: string; events: string[]; description: string | null; enabled: boolean; created_by: string; secret_hint: string
  header_hints: WebhookHeader[] | string
  last_success_at: Date | null; last_failure_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date
}
type SealedRow = Row & { sealed_version: string; sealed_key_id: string; sealed_iv: string; sealed: string }
type SealedHeadersRow = { headers_sealed_version: string | null; headers_sealed_key_id: string | null; headers_sealed_iv: string | null; headers_sealed: string | null }
type DeliveryRow = {
  id: string; webhook_id: string; event_id: string; event: string; status: DeliveryStatus; attempts: number; next_attempt_at: Date | null
  last_status: number | null; last_error: string | null; created_at: Date; delivered_at: Date | null; payload: unknown
}

const COLS = `id, account_id, connection_id, url, events, description, enabled, created_by, secret_hint, header_hints, last_success_at, last_failure_at, last_error, created_at, updated_at`
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
const view = (r: Row): Webhook => ({
  id: r.id, connectionId: r.connection_id, url: r.url, events: r.events.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e)),
  description: r.description, enabled: r.enabled, createdBy: r.created_by, secretHint: r.secret_hint,
  headers: typeof r.header_hints === "string" ? JSON.parse(r.header_hints) : r.header_hints,
  lastSuccessAt: iso(r.last_success_at), lastFailureAt: iso(r.last_failure_at), lastError: r.last_error,
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
})
export const deliveryView = (r: DeliveryRow): Delivery => ({
  id: r.id, webhookId: r.webhook_id, eventId: r.event_id, event: r.event, status: r.status, attempts: r.attempts,
  nextAttemptAt: r.status === "pending" ? iso(r.next_attempt_at) : null, lastStatus: r.last_status, lastError: r.last_error,
  createdAt: iso(r.created_at)!, deliveredAt: iso(r.delivered_at),
  payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A webhook URL as it's kept, or why it can't be one: http(s) only (https outside local development), no credentials
 * in it, and not a private, loopback or link-local host. The sessions service checks what the name resolves to again
 * on every request (a name can point anywhere later).
 */
export function checkWebhookUrl(raw: string, opts: { allowHttp: boolean }): string {
  const text = raw.trim()
  if (!text || text.length > 2000) throw new WebhookError("invalid", "the URL must be 1–2000 characters")
  let url: URL
  try { url = new URL(text) } catch { throw new WebhookError("invalid", "that isn't a valid URL") }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) throw new WebhookError("invalid", opts.allowHttp ? "the URL must be http(s)" : "the URL must be https")
  if (url.username || url.password) throw new WebhookError("invalid", "put credentials in the URL's path or query, not before the host")
  if (!url.hostname || isPrivateHost(url.hostname)) throw new WebhookError("invalid", "the URL must be on the public internet (not a private, local or internal address)")
  url.hash = ""
  return url.href
}

function checkEvents(events: readonly string[] | undefined): WebhookEvent[] {
  if (!events) return [...WEBHOOK_EVENTS]
  const unknown = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))
  if (unknown.length) throw new WebhookError("invalid", `unknown event${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (choose from ${WEBHOOK_EVENTS.join(", ")})`)
  const set = [...new Set(events)] as WebhookEvent[]
  if (!set.length) throw new WebhookError("invalid", "choose at least one event")
  return WEBHOOK_EVENTS.filter((e) => set.includes(e))
}

const cleanDescription = (d: string | null | undefined) => (d == null ? null : d.trim().slice(0, 200) || null)

/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/
/** Visible ASCII, spaces and tabs: nothing that could end the header or start another. */
const HEADER_VALUE = /^[\t\x20-\x7e]{1,2000}$/
/**
 * Headers Parley sets itself, or that would change how the request is framed or routed: a webhook can't send its own.
 * Everything else (Authorization, X-Api-Key, …) is the receiver's business.
 */
const RESERVED_HEADERS = new Set([
  "host", "content-type", "content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "te", "trailer",
  "upgrade", "expect", "user-agent", "proxy-authorization", "proxy-connection",
])
const reserved = (lower: string) => RESERVED_HEADERS.has(lower) || lower.startsWith("parley-") || lower.startsWith("sec-")

/** A header's value, as shown back: its last four characters when it's long enough not to give itself away. */
const headerHint = (value: string) => (value.length >= 12 ? value.slice(-4) : "")

/**
 * The headers a webhook will send, checked: valid names, one of each (case doesn't count), none Parley sets itself,
 * values on one line. `value: null` keeps what `existing` has under that name.
 */
export function checkHeaders(input: readonly WebhookHeaderInput[], existing: Record<string, string> = {}): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  const seen = new Set<string>()
  const kept = new Map(Object.entries(existing).map(([k, v]) => [k.toLowerCase(), v]))
  for (const h of input) {
    const name = h.name.trim()
    if (!name && !h.value?.trim()) continue
    if (!HEADER_NAME.test(name)) throw new WebhookError("invalid", `"${name.slice(0, 100)}" isn't a valid header name (letters, digits and - only, like X-Api-Key)`)
    const lower = name.toLowerCase()
    if (reserved(lower)) throw new WebhookError("invalid", `Parley sets ${name} itself; use another header (Authorization or X-Api-Key, say)`)
    if (seen.has(lower)) throw new WebhookError("invalid", `${name} is there twice`)
    seen.add(lower)
    const value = h.value === null ? kept.get(lower) : h.value.trim()
    if (!value) throw new WebhookError("invalid", `give ${name} a value`)
    if (!HEADER_VALUE.test(value)) throw new WebhookError("invalid", `${name}'s value must be 1–2000 plain characters on one line`)
    out.push({ name, value })
  }
  if (out.length > MAX_WEBHOOK_HEADERS) throw new WebhookError("invalid", `a webhook can send at most ${MAX_WEBHOOK_HEADERS} headers of its own`)
  return out
}

/** A fresh signing secret: `whsec_` and 32 random bytes, base64url. */
function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`
}

const binding = (accountId: string, id: string, version: string) => ({ userId: accountId, kind: "webhook-secret" as const, purpose: "webhook", name: id, version })
/** The headers are sealed apart from the signing secret, under their own purpose, so neither opens as the other. */
const headersBinding = (accountId: string, id: string, version: string) => ({ userId: accountId, kind: "webhook-secret" as const, purpose: "webhook-headers", name: id, version })

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")

/**
 * The `Parley-Signature` header for a request body: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` under the
 * webhook's secret (the whole `whsec_…` string is the key). Receivers recompute it, compare in constant time, and
 * reject a timestamp more than a few minutes old.
 */
export async function signWebhook(secret: string, body: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return `t=${timestamp},v1=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)))}`
}

/** Webhooks: one per environment, like `Exits` (it holds the sealing key). */
export class Webhooks {
  #seal: SecretSeal | undefined
  readonly #config: IdentityConfig

  constructor(config: IdentityConfig) {
    this.#config = config
  }

  async #sealer(): Promise<SecretSeal> {
    return (this.#seal ??= serverSeal(await SignInKey.from(this.#config.signInKey)))
  }

  async #sealSecret(accountId: string, id: string, secret: string) {
    const version = crypto.randomUUID()
    const s = await (await this.#sealer()).seal(binding(accountId, id, version), enc.encode(secret))
    return { version, keyId: s.keyId, iv: s.iv, sealed: s.sealed, hint: secret.slice(-4) }
  }

  /** The columns a set of headers is kept in: sealed values and the hints shown back (all null/empty for none). */
  async #sealHeaders(accountId: string, id: string, headers: Array<{ name: string; value: string }>) {
    const hints = JSON.stringify(headers.map((h) => ({ name: h.name, hint: headerHint(h.value) })))
    if (!headers.length) return { hints, version: null, keyId: null, iv: null, sealed: null }
    const version = crypto.randomUUID()
    const s = await (await this.#sealer()).seal(headersBinding(accountId, id, version), enc.encode(JSON.stringify(headers)))
    return { hints, version, keyId: s.keyId, iv: s.iv, sealed: s.sealed }
  }

  /** The headers a webhook sends of its own, opened: name to value, in the order they were given. */
  async headers(sql: Sql, accountId: string, id: string): Promise<Record<string, string>> {
    if (!UUID.test(id)) throw new WebhookError("not_found", "no such webhook")
    const [row] = await sql<SealedHeadersRow>(
      `select headers_sealed_version, headers_sealed_key_id, headers_sealed_iv, headers_sealed from parley.webhook where id = $1 and account_id = $2`,
      [id, accountId]
    )
    if (!row) throw new WebhookError("not_found", "no such webhook")
    if (!row.headers_sealed_version || !row.headers_sealed_key_id || !row.headers_sealed_iv || !row.headers_sealed) return {}
    const bytes = await (await this.#sealer()).open(headersBinding(accountId, id, row.headers_sealed_version), {
      scheme: "server.v1", keyId: row.headers_sealed_key_id, iv: row.headers_sealed_iv, sealed: row.headers_sealed,
    })
    if (!bytes) throw new Error(`webhook ${id}'s headers don't open`)
    const list = JSON.parse(new TextDecoder().decode(bytes)) as Array<{ name: string; value: string }>
    return Object.fromEntries(list.map((h) => [h.name, h.value]))
  }

  /** Plain http is only for local development (a receiver on this machine still needs to be public, though). */
  get allowHttp(): boolean {
    return this.#config.env === "local"
  }

  /** The account's webhooks, or one connection's. */
  async list(sql: Sql, accountId: string, opts: { connectionId?: string | undefined } = {}): Promise<Webhook[]> {
    if (opts.connectionId && !UUID.test(opts.connectionId)) return []
    return (await sql<Row>(
      `select ${COLS} from parley.webhook where account_id = $1 and ($2::uuid is null or connection_id = $2) order by created_at`,
      [accountId, opts.connectionId ?? null]
    )).map(view)
  }

  /** How many webhooks each of the account's connections has (on or off), by connection id. */
  async counts(sql: Sql, accountId: string): Promise<Map<string, number>> {
    const rows = await sql<{ connection_id: string; n: number }>(`select connection_id, count(*)::int as n from parley.webhook where account_id = $1 group by connection_id`, [accountId])
    return new Map(rows.map((r) => [r.connection_id, r.n]))
  }

  async get(sql: Sql, accountId: string, id: string): Promise<Webhook> {
    if (!UUID.test(id)) throw new WebhookError("not_found", "no such webhook")
    const [row] = await sql<Row>(`select ${COLS} from parley.webhook where id = $1 and account_id = $2`, [id, accountId])
    if (!row) throw new WebhookError("not_found", "no such webhook")
    return view(row)
  }

  /** Register a webhook on one of the account's connections. Answers it with its signing secret, the one time the secret is handed over unasked. */
  async create(sql: Sql, accountId: string, req: {
    connectionId: string; url: string; events?: readonly string[] | undefined; description?: string | null | undefined; createdBy?: string | undefined
    headers?: readonly WebhookHeaderInput[] | undefined
  }): Promise<{ webhook: Webhook; secret: string }> {
    const url = checkWebhookUrl(req.url, { allowHttp: this.allowHttp })
    const events = checkEvents(req.events)
    const headers = checkHeaders(req.headers ?? [])
    if (!UUID.test(req.connectionId)) throw new WebhookError("not_found", "no such connection")
    const [conn] = await sql<{ id: string }>(`select id from parley.connection where id = $1 and account_id = $2`, [req.connectionId, accountId])
    if (!conn) throw new WebhookError("not_found", "no such connection")
    const id = crypto.randomUUID()
    const secret = newWebhookSecret()
    const s = await this.#sealSecret(accountId, id, secret)
    const h = await this.#sealHeaders(accountId, id, headers)
    const [row] = await sql<Row>(
      `insert into parley.webhook (id, account_id, connection_id, url, events, description, created_by, sealed_version, sealed_key_id, sealed_iv, sealed, secret_hint,
                                   header_hints, headers_sealed_version, headers_sealed_key_id, headers_sealed_iv, headers_sealed)
       select $1, $2, $13, $3, $4, $5, $6, $7, $8, $9, $10, $11, $14, $15, $16, $17, $18
        where (select count(*) from parley.webhook where connection_id = $13) < $12
       returning ${COLS}`,
      [id, accountId, url, events, cleanDescription(req.description), (req.createdBy ?? "dashboard").slice(0, 200), s.version, s.keyId, s.iv, s.sealed, s.hint, MAX_WEBHOOKS, req.connectionId,
        h.hints, h.version, h.keyId, h.iv, h.sealed]
    )
    if (!row) throw new WebhookError("limit", `a number can have at most ${MAX_WEBHOOKS} webhooks; remove one first`)
    return { webhook: view(row), secret }
  }

  /**
   * Change a webhook's URL, events, description, headers, or whether it's on. `headers` replaces the whole set (empty
   * removes them all). Turning one off fails what it still had waiting (nothing is held back to flood it when it
   * comes back on).
   */
  async update(sql: Sql, accountId: string, id: string, req: {
    url?: string | undefined; events?: readonly string[] | undefined; description?: string | null | undefined; enabled?: boolean | undefined
    headers?: readonly WebhookHeaderInput[] | undefined
  }): Promise<Webhook> {
    await this.get(sql, accountId, id)
    const url = req.url === undefined ? null : checkWebhookUrl(req.url, { allowHttp: this.allowHttp })
    const events = req.events === undefined ? null : checkEvents(req.events)
    const h = req.headers === undefined
      ? null
      : await this.#sealHeaders(accountId, id, checkHeaders(req.headers, req.headers.some((x) => x.value === null) ? await this.headers(sql, accountId, id) : {}))
    const [row] = await sql<Row>(
      `update parley.webhook set url = coalesce($3, url), events = coalesce($4, events),
              description = case when $5 then $6 else description end, enabled = coalesce($7, enabled),
              header_hints = case when $8 then $9::jsonb else header_hints end,
              headers_sealed_version = case when $8 then $10::uuid else headers_sealed_version end,
              headers_sealed_key_id = case when $8 then $11 else headers_sealed_key_id end,
              headers_sealed_iv = case when $8 then $12 else headers_sealed_iv end,
              headers_sealed = case when $8 then $13 else headers_sealed end,
              updated_at = now()
        where id = $1 and account_id = $2 returning ${COLS}`,
      [id, accountId, url, events, req.description !== undefined, cleanDescription(req.description), req.enabled ?? null,
        h !== null, h?.hints ?? null, h?.version ?? null, h?.keyId ?? null, h?.iv ?? null, h?.sealed ?? null]
    )
    if (!row) throw new WebhookError("not_found", "no such webhook")
    if (req.enabled === false) {
      await sql(
        `update parley.webhook_delivery set status = 'failed', last_error = 'the webhook was turned off', next_attempt_at = now()
          where webhook_id = $1 and status = 'pending'`,
        [id]
      )
    }
    return view(row)
  }

  /** Replace a webhook's signing secret. The old one stops working at once; answers the new one. */
  async rotateSecret(sql: Sql, accountId: string, id: string): Promise<{ webhook: Webhook; secret: string }> {
    await this.get(sql, accountId, id)
    const secret = newWebhookSecret()
    const s = await this.#sealSecret(accountId, id, secret)
    const [row] = await sql<Row>(
      `update parley.webhook set sealed_version = $3, sealed_key_id = $4, sealed_iv = $5, sealed = $6, secret_hint = $7, updated_at = now()
        where id = $1 and account_id = $2 returning ${COLS}`,
      [id, accountId, s.version, s.keyId, s.iv, s.sealed, s.hint]
    )
    if (!row) throw new WebhookError("not_found", "no such webhook")
    return { webhook: view(row), secret }
  }

  /** The signing secret, opened (for the account holder to copy on the dashboard, and to sign with). */
  async secret(sql: Sql, accountId: string, id: string): Promise<string> {
    if (!UUID.test(id)) throw new WebhookError("not_found", "no such webhook")
    const [row] = await sql<SealedRow>(`select ${COLS}, sealed_version, sealed_key_id, sealed_iv, sealed from parley.webhook where id = $1 and account_id = $2`, [id, accountId])
    if (!row) throw new WebhookError("not_found", "no such webhook")
    const bytes = await (await this.#sealer()).open(binding(accountId, id, row.sealed_version), { scheme: "server.v1", keyId: row.sealed_key_id, iv: row.sealed_iv, sealed: row.sealed })
    if (!bytes) throw new Error(`webhook ${id}'s secret doesn't open`)
    return new TextDecoder().decode(bytes)
  }

  async remove(sql: Sql, accountId: string, id: string): Promise<void> {
    if (!UUID.test(id)) throw new WebhookError("not_found", "no such webhook")
    const rows = await sql(`delete from parley.webhook where id = $1 and account_id = $2 returning id`, [id, accountId])
    if (!rows.length) throw new WebhookError("not_found", "no such webhook")
  }

  /**
   * Queue a test event for one webhook (sent like any other, whatever it subscribes to, even while it's off). It's
   * shaped like a message.received (the same envelope, `data.chat` and `data.message`), so a receiver built against
   * the test reads real messages the same way.
   */
  async test(sql: Sql, accountId: string, id: string): Promise<Delivery> {
    const hook = await this.get(sql, accountId, id)
    const [conn] = await sql<{ id: string; channel: string; handle: string | null }>(`select id, channel, handle from parley.connection where id = $1`, [hook.connectionId])
    const eventId = crypto.randomUUID()
    const now = new Date().toISOString()
    const payload = {
      id: eventId, type: TEST_EVENT, created_at: now,
      connection: { id: hook.connectionId, channel: conn?.channel ?? null, account: conn ? accountLabel(conn) : null },
      data: {
        webhook_id: hook.id,
        chat: { id: "test", name: "Parley test", kind: "direct" },
        message: { id: `test-${eventId}`, from: "test", from_me: false, text: "A test event from Parley. If you can read this, your endpoint works.", at: now },
      },
    }
    const [row] = await sql<DeliveryRow>(
      `insert into parley.webhook_delivery (webhook_id, event_id, event, payload) values ($1, $2, $3, $4) returning *`,
      [hook.id, eventId, TEST_EVENT, JSON.stringify(payload)]
    )
    return deliveryView(row!)
  }

  /**
   * Send a delivery's event again, as a new delivery to the same webhook: the same body and event id (so a receiver
   * that dedupes on it can tell it's the same event), with a fresh media download link if it carried one. The webhook
   * must be on (test events go either way).
   */
  async resend(sql: Sql, accountId: string, deliveryId: string): Promise<Delivery> {
    const was = await this.delivery(sql, accountId, deliveryId)
    if (!was) throw new WebhookError("not_found", "no such delivery")
    const hook = await this.get(sql, accountId, was.webhookId)
    if (!hook.enabled && was.event !== TEST_EVENT) throw new WebhookError("invalid", "the webhook is off; turn it on to resend")
    const payload = structuredClone(was.payload) as { connection?: { id?: string }; data?: { chat?: { id?: string }; message?: { id?: string; media?: Record<string, unknown> } } }
    const media = payload.data?.message?.media
    if (media?.download_url && this.#config.publicUrl && payload.connection?.id && payload.data?.chat?.id && payload.data.message?.id) {
      const link = await signMediaLink(this.#config.signInKey, { accountId, connectionId: payload.connection.id, chatId: payload.data.chat.id, messageId: payload.data.message.id })
      media.download_url = `${this.#config.publicUrl}/media/${link.token}`
      media.download_expires_at = link.expiresAt
    }
    const [row] = await sql<DeliveryRow>(
      `insert into parley.webhook_delivery (webhook_id, event_id, event, payload) values ($1, $2, $3, $4) returning *`,
      [hook.id, was.eventId, was.event, JSON.stringify(payload)]
    )
    return deliveryView(row!)
  }

  async delivery(sql: Sql, accountId: string, deliveryId: string): Promise<Delivery | undefined> {
    if (!UUID.test(deliveryId)) return undefined
    const [row] = await sql<DeliveryRow>(
      `select d.* from parley.webhook_delivery d join parley.webhook w on w.id = d.webhook_id where d.id = $1 and w.account_id = $2`,
      [deliveryId, accountId]
    )
    return row && deliveryView(row)
  }

  /** The latest deliveries across the account's webhooks (or one connection's, or one webhook's), newest first. */
  async deliveries(sql: Sql, accountId: string, opts: { webhookId?: string | undefined; connectionId?: string | undefined; limit: number }): Promise<Delivery[]> {
    if ((opts.webhookId && !UUID.test(opts.webhookId)) || (opts.connectionId && !UUID.test(opts.connectionId))) return []
    const rows = await sql<DeliveryRow>(
      `select d.* from parley.webhook_delivery d join parley.webhook w on w.id = d.webhook_id
        where w.account_id = $1 and ($2::uuid is null or d.webhook_id = $2) and ($4::uuid is null or w.connection_id = $4)
        order by d.created_at desc limit $3`,
      [accountId, opts.webhookId ?? null, opts.limit, opts.connectionId ?? null]
    )
    return rows.map(deliveryView)
  }
}

/** An event to fan out to every webhook of the account that wants it: its type and its `data`. */
export type WebhookEventInput = { type: WebhookEvent; data: Record<string, unknown> }

/** Whether a connection has a webhook that's on (so it skips building events nobody will get). */
export async function hasWebhooks(sql: Sql, connectionId: string): Promise<boolean> {
  const [r] = await sql<{ yes: boolean }>(`select exists (select 1 from parley.webhook where connection_id = $1 and enabled) as yes`, [connectionId])
  return Boolean(r?.yes)
}

/** A number relinked: its webhooks (and their secrets, bound to the webhook, not the link) move to the new connection. */
export async function moveWebhooks(sql: Sql, from: string[], to: string): Promise<void> {
  if (!from.length) return
  await sql(`update parley.webhook set connection_id = $1, updated_at = now() where connection_id = any ($2::uuid[])`, [to, from])
}

/**
 * Queue events for every webhook of the connection that's on and wants them: one delivery each, sent by the sessions
 * service's delivery loop. Each event gets one id, the same in every webhook's copy (and every retry).
 * `connection` is the envelope's account section (its `id` picks the webhooks). Answers how many deliveries were queued.
 */
export async function queueEvents(sql: Sql, connection: { id: string } & Record<string, unknown>, events: WebhookEventInput[], now = new Date()): Promise<number> {
  if (!events.length) return 0
  const rows = events.map((e) => {
    const id = crypto.randomUUID()
    return { event_id: id, type: e.type, payload: { id, type: e.type, created_at: now.toISOString(), connection, data: e.data } }
  })
  const out = await sql<{ id: string }>(
    `insert into parley.webhook_delivery (webhook_id, event_id, event, payload)
     select w.id, (e.v ->> 'event_id')::uuid, e.v ->> 'type', e.v -> 'payload'
       from jsonb_array_elements($2::jsonb) with ordinality as e(v, ord)
       join parley.webhook w on w.connection_id = $1 and w.enabled and (e.v ->> 'type') = any (w.events)
      order by e.ord
     returning id`,
    [connection.id, JSON.stringify(rows)]
  )
  return out.length
}
