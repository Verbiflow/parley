import { SignInKey, serverSeal, type IdentityConfig, type SecretSeal, type Sql } from "@parley/auth"
import { isPrivateHost } from "../mcp/media.ts"

/**
 * Webhooks: URLs an account registers to hear, as it happens, about new messages, reactions and deletions on its
 * connections. This half is edge-safe (the dashboard and MCP on the Worker use it): registering, listing, changing and
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

/** The most webhooks one account can have. */
export const MAX_WEBHOOKS = 10
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
}
export type Webhook = {
  id: string; url: string; events: WebhookEvent[]; description: string | null; enabled: boolean; createdBy: string
  /** The secret's last few characters, so a person can tell which one their receiver has. */
  secretHint: string
  lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null
  createdAt: string; updatedAt: string
}

type Row = {
  id: string; account_id: string; url: string; events: string[]; description: string | null; enabled: boolean; created_by: string; secret_hint: string
  last_success_at: Date | null; last_failure_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date
}
type SealedRow = Row & { sealed_version: string; sealed_key_id: string; sealed_iv: string; sealed: string }
type DeliveryRow = {
  id: string; webhook_id: string; event_id: string; event: string; status: DeliveryStatus; attempts: number; next_attempt_at: Date | null
  last_status: number | null; last_error: string | null; created_at: Date; delivered_at: Date | null
}

const COLS = `id, account_id, url, events, description, enabled, created_by, secret_hint, last_success_at, last_failure_at, last_error, created_at, updated_at`
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
const view = (r: Row): Webhook => ({
  id: r.id, url: r.url, events: r.events.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e)),
  description: r.description, enabled: r.enabled, createdBy: r.created_by, secretHint: r.secret_hint,
  lastSuccessAt: iso(r.last_success_at), lastFailureAt: iso(r.last_failure_at), lastError: r.last_error,
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
})
export const deliveryView = (r: DeliveryRow): Delivery => ({
  id: r.id, webhookId: r.webhook_id, eventId: r.event_id, event: r.event, status: r.status, attempts: r.attempts,
  nextAttemptAt: r.status === "pending" ? iso(r.next_attempt_at) : null, lastStatus: r.last_status, lastError: r.last_error,
  createdAt: iso(r.created_at)!, deliveredAt: iso(r.delivered_at),
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

/** A fresh signing secret: `whsec_` and 32 random bytes, base64url. */
function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`
}

const binding = (accountId: string, id: string, version: string) => ({ userId: accountId, kind: "webhook-secret" as const, purpose: "webhook", name: id, version })

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

  /** Plain http is only for local development (a receiver on this machine still needs to be public, though). */
  get allowHttp(): boolean {
    return this.#config.env === "local"
  }

  async list(sql: Sql, accountId: string): Promise<Webhook[]> {
    return (await sql<Row>(`select ${COLS} from parley.webhook where account_id = $1 order by created_at`, [accountId])).map(view)
  }

  async get(sql: Sql, accountId: string, id: string): Promise<Webhook> {
    if (!UUID.test(id)) throw new WebhookError("not_found", "no such webhook")
    const [row] = await sql<Row>(`select ${COLS} from parley.webhook where id = $1 and account_id = $2`, [id, accountId])
    if (!row) throw new WebhookError("not_found", "no such webhook")
    return view(row)
  }

  /** Register a webhook. Answers it with its signing secret, the one time the secret is handed over unasked. */
  async create(sql: Sql, accountId: string, req: { url: string; events?: readonly string[] | undefined; description?: string | null | undefined; createdBy?: string | undefined }): Promise<{ webhook: Webhook; secret: string }> {
    const url = checkWebhookUrl(req.url, { allowHttp: this.allowHttp })
    const events = checkEvents(req.events)
    const id = crypto.randomUUID()
    const secret = newWebhookSecret()
    const s = await this.#sealSecret(accountId, id, secret)
    const [row] = await sql<Row>(
      `insert into parley.webhook (id, account_id, url, events, description, created_by, sealed_version, sealed_key_id, sealed_iv, sealed, secret_hint)
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        where (select count(*) from parley.webhook where account_id = $2) < $12
       returning ${COLS}`,
      [id, accountId, url, events, cleanDescription(req.description), (req.createdBy ?? "dashboard").slice(0, 200), s.version, s.keyId, s.iv, s.sealed, s.hint, MAX_WEBHOOKS]
    )
    if (!row) throw new WebhookError("limit", `an account can have at most ${MAX_WEBHOOKS} webhooks; remove one first`)
    return { webhook: view(row), secret }
  }

  /**
   * Change a webhook's URL, events, description, or whether it's on. Turning one off fails what it still had waiting
   * (nothing is held back to flood it when it comes back on).
   */
  async update(sql: Sql, accountId: string, id: string, req: { url?: string | undefined; events?: readonly string[] | undefined; description?: string | null | undefined; enabled?: boolean | undefined }): Promise<Webhook> {
    await this.get(sql, accountId, id)
    const url = req.url === undefined ? null : checkWebhookUrl(req.url, { allowHttp: this.allowHttp })
    const events = req.events === undefined ? null : checkEvents(req.events)
    const [row] = await sql<Row>(
      `update parley.webhook set url = coalesce($3, url), events = coalesce($4, events),
              description = case when $5 then $6 else description end, enabled = coalesce($7, enabled), updated_at = now()
        where id = $1 and account_id = $2 returning ${COLS}`,
      [id, accountId, url, events, req.description !== undefined, cleanDescription(req.description), req.enabled ?? null]
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

  /** Queue a test event for one webhook (sent like any other, whatever it subscribes to, even while it's off). */
  async test(sql: Sql, accountId: string, id: string): Promise<Delivery> {
    const hook = await this.get(sql, accountId, id)
    const eventId = crypto.randomUUID()
    const payload = {
      id: eventId, type: TEST_EVENT, created_at: new Date().toISOString(),
      data: { webhook_id: hook.id, text: "A test event from Parley. If you can read this, your endpoint works." },
    }
    const [row] = await sql<DeliveryRow>(
      `insert into parley.webhook_delivery (webhook_id, event_id, event, payload) values ($1, $2, $3, $4) returning *`,
      [hook.id, eventId, TEST_EVENT, JSON.stringify(payload)]
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

  /** The latest deliveries across the account's webhooks (or one), newest first. */
  async deliveries(sql: Sql, accountId: string, opts: { webhookId?: string | undefined; limit: number }): Promise<Delivery[]> {
    if (opts.webhookId && !UUID.test(opts.webhookId)) return []
    const rows = await sql<DeliveryRow>(
      `select d.* from parley.webhook_delivery d join parley.webhook w on w.id = d.webhook_id
        where w.account_id = $1 and ($2::uuid is null or d.webhook_id = $2)
        order by d.created_at desc limit $3`,
      [accountId, opts.webhookId ?? null, opts.limit]
    )
    return rows.map(deliveryView)
  }
}

/** An event to fan out to every webhook of the account that wants it: its type and its `data`. */
export type WebhookEventInput = { type: WebhookEvent; data: Record<string, unknown> }

/** Whether an account has a webhook that's on (so a connection skips building events nobody will get). */
export async function hasWebhooks(sql: Sql, accountId: string): Promise<boolean> {
  const [r] = await sql<{ yes: boolean }>(`select exists (select 1 from parley.webhook where account_id = $1 and enabled) as yes`, [accountId])
  return Boolean(r?.yes)
}

/**
 * Queue events for every webhook of the account that's on and wants them: one delivery each, sent by the sessions
 * service's delivery loop. Each event gets one id, the same in every webhook's copy (and every retry).
 * `connection` is the envelope's account section. Answers how many deliveries were queued.
 */
export async function queueEvents(sql: Sql, accountId: string, connection: Record<string, unknown>, events: WebhookEventInput[], now = new Date()): Promise<number> {
  if (!events.length) return 0
  const rows = events.map((e) => {
    const id = crypto.randomUUID()
    return { event_id: id, type: e.type, payload: { id, type: e.type, created_at: now.toISOString(), connection, data: e.data } }
  })
  const out = await sql<{ id: string }>(
    `insert into parley.webhook_delivery (webhook_id, event_id, event, payload)
     select w.id, (e.v ->> 'event_id')::uuid, e.v ->> 'type', e.v -> 'payload'
       from jsonb_array_elements($2::jsonb) with ordinality as e(v, ord)
       join parley.webhook w on w.account_id = $1 and w.enabled and (e.v ->> 'type') = any (w.events)
      order by e.ord
     returning id`,
    [accountId, JSON.stringify(rows)]
  )
  return out.length
}
