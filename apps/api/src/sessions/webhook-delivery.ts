import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import type { IdentityConfig, Sql } from "@parley/auth"
import type { InboundMessage } from "@parley/channels"
import { isPrivateHost } from "../mcp/media.ts"
import { accountLabel } from "../mcp/accounts.ts"
import { signMediaLink } from "../media-link.ts"
import { publicOnlyLookup } from "./fetch-media.ts"
import type { ChangedReaction, ForgottenMessage, MessageKey } from "./chats.ts"
import type { Connection } from "./store.ts"
import {
  DELIVERY_RETENTION_DAYS, MAX_ATTEMPTS, RETRY_DELAYS_MS, hasWebhooks, queueEvents, signWebhook,
  type WebhookEventInput, type Webhooks,
} from "./webhooks.ts"

/**
 * Sending webhooks, on the sessions service: turning what a connection just stored into events, and the delivery loop
 * that posts them. Every request goes through `postWebhook`'s network checks: the URL's host must resolve only to
 * public addresses, and the socket connects to the address checked (so a name can't be pointed at the VPC between
 * the check and the connect). Redirects are never followed.
 */

/** How long a receiver has to answer. */
export const WEBHOOK_TIMEOUT_MS = 10_000
/** A claimed delivery must be reported within this, or it's tried again (its worker died mid-send). */
const LEASE_MS = 60_000
/** Deliveries one tick sends at most. */
const BATCH = 25
const USER_AGENT = "Parley-Webhooks/1.0 (+https://itsparley.com)"

export class WebhookSendError extends Error {}

/** Posts one webhook request; answers the HTTP status, throws on a network failure or a refused address. */
export type WebhookPoster = (req: { url: string; body: string; headers: Record<string, string> }) => Promise<{ status: number }>

const refuse = () => new WebhookSendError("the URL resolves to a private, local or internal address")
const safeLookup = publicOnlyLookup(refuse)

/**
 * POST to a webhook URL from the sessions service. `allowPrivate` is only for tests (a receiver on 127.0.0.1); nothing
 * in the service passes it.
 */
export function makeWebhookPoster(opts: { allowPrivate?: boolean; timeoutMs?: number } = {}): WebhookPoster {
  const timeout = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS
  return ({ url: raw, body, headers }) => new Promise((resolve, reject) => {
    let url: URL
    try { url = new URL(raw) } catch { return reject(new WebhookSendError("the URL isn't valid")) }
    if (url.protocol !== "https:" && url.protocol !== "http:") return reject(new WebhookSendError("the URL must be http(s)"))
    // IP literals skip the lookup, so check them here.
    if (!opts.allowPrivate && isPrivateHost(url.hostname)) return reject(refuse())
    const send = url.protocol === "https:" ? httpsRequest : httpRequest
    const req = send(url, {
      method: "POST", timeout, ...(opts.allowPrivate ? {} : { lookup: safeLookup as never }),
      headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "user-agent": USER_AGENT },
    }, (res: IncomingMessage) => {
      // The answer's body is never read: only its status counts.
      res.resume()
      resolve({ status: res.statusCode ?? 0 })
    })
    // Covers the whole exchange (a receiver that never answers), not just an idle socket.
    const timer = setTimeout(() => req.destroy(new WebhookSendError(`no answer within ${timeout / 1000}s`)), timeout)
    req.on("close", () => clearTimeout(timer))
    req.on("timeout", () => req.destroy(new WebhookSendError(`no answer within ${timeout / 1000}s`)))
    req.on("error", (e) => reject(e instanceof WebhookSendError ? e : new WebhookSendError(e.message || "the request failed")))
    req.end(body)
  })
}

export const postWebhook: WebhookPoster = makeWebhookPoster()

type Claimed = { id: string; webhook_id: string; event_id: string; event: string; payload: unknown; attempts: number; url: string; account_id: string }

/**
 * Send what's due, from any worker (rows are claimed with SKIP LOCKED, so two never send the same one at once).
 * A 2xx delivers it; anything else (another status, a timeout, a refused address) waits and tries again, up to
 * `MAX_ATTEMPTS` in all. Answers how many were sent (delivered or not).
 */
export async function deliverDue(ctx: { sql: Sql; webhooks: Webhooks; post: WebhookPoster }, now = new Date()): Promise<number> {
  const { sql } = ctx
  // A send whose worker died: tried again, or failed if that was its last attempt.
  await sql(
    `update parley.webhook_delivery set
            status = case when attempts >= $2 then 'failed' else 'pending' end,
            last_error = coalesce(last_error, 'the send was interrupted'), next_attempt_at = $1, lease_until = null
      where status = 'sending' and lease_until < $1`,
    [now, MAX_ATTEMPTS]
  )
  const claimed = await sql<Claimed>(
    `with due as (
       select d.id from parley.webhook_delivery d join parley.webhook w on w.id = d.webhook_id
        where d.status = 'pending' and d.next_attempt_at <= $1 and (w.enabled or d.event = 'webhook.test')
        order by d.next_attempt_at, d.created_at limit $2
        for update of d skip locked
     )
     update parley.webhook_delivery d set status = 'sending', attempts = d.attempts + 1, lease_until = $3
       from due, parley.webhook w
      where d.id = due.id and w.id = d.webhook_id
     returning d.id, d.webhook_id, d.event_id, d.event, d.payload, d.attempts, w.url, w.account_id`,
    [now, BATCH, new Date(now.getTime() + LEASE_MS)]
  )
  await Promise.all(claimed.map((d) => sendOne(ctx, d, now)))
  return claimed.length
}

async function sendOne(ctx: { sql: Sql; webhooks: Webhooks; post: WebhookPoster }, d: Claimed, now: Date): Promise<void> {
  let status: number | null = null
  let error: string | null = null
  try {
    const [secret, own] = await Promise.all([ctx.webhooks.secret(ctx.sql, d.account_id, d.webhook_id), ctx.webhooks.headers(ctx.sql, d.account_id, d.webhook_id)])
    const body = JSON.stringify(d.payload)
    const signature = await signWebhook(secret, body, Math.floor(Date.now() / 1000))
    const res = await ctx.post({
      url: d.url, body,
      headers: { ...own, "parley-event": d.event, "parley-event-id": d.event_id, "parley-delivery-id": d.id, "parley-attempt": String(d.attempts), "parley-signature": signature },
    })
    status = res.status
    if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? `answered HTTP ${status} (redirects aren't followed)` : `answered HTTP ${status}`
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)) || "the request failed"
  }
  error = error?.slice(0, 500) ?? null
  const ok = error === null
  const last = d.attempts >= MAX_ATTEMPTS
  const retryAt = new Date(now.getTime() + (RETRY_DELAYS_MS[d.attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]))
  await ctx.sql(
    `update parley.webhook_delivery set status = $2, last_status = $3, last_error = $4, lease_until = null,
            delivered_at = case when $2::text = 'delivered' then $5::timestamptz else null end, next_attempt_at = $6::timestamptz
      where id = $1 and status = 'sending'`,
    [d.id, ok ? "delivered" : last ? "failed" : "pending", status, error, now, ok || last ? now : retryAt]
  )
  await ctx.sql(
    ok
      ? `update parley.webhook set last_success_at = $2 where id = $1`
      : `update parley.webhook set last_failure_at = $2, last_error = $3 where id = $1`,
    ok ? [d.webhook_id, now] : [d.webhook_id, now, error]
  )
}

/** Forget delivered and failed deliveries past the retention window. */
export async function pruneDeliveries(sql: Sql, now = new Date()): Promise<void> {
  await sql(
    `delete from parley.webhook_delivery where status in ('delivered', 'failed') and created_at < $1`,
    [new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000)]
  )
}

// ---- Events from what a connection stored --------------------------------------------------------------------------

type ChatInfo = { id: string; name: string | null; kind: string }

async function chatsOf(sql: Sql, connectionId: string, ids: string[]): Promise<Map<string, ChatInfo>> {
  const rows = await sql<ChatInfo>(`select id, name, kind from parley.chat where connection_id = $1 and id = any ($2::text[])`, [connectionId, [...new Set(ids)]])
  return new Map(rows.map((r) => [r.id, r]))
}
const chatOut = (chats: Map<string, ChatInfo>, id: string) => ({ id, name: chats.get(id)?.name ?? null, kind: chats.get(id)?.kind ?? null })

/**
 * What a connection just stored, as webhook events, queued for each of its webhooks that wants them. Callers
 * pass only live changes (see the channel contract's `live`). Best effort: a failure here is logged by the caller and
 * never stops the message being stored.
 */
export async function emitLiveEvents(
  ctx: { sql: Sql; config: IdentityConfig },
  conn: Pick<Connection, "id" | "accountId" | "channel">,
  change: { messages?: { stored: MessageKey[]; inbound: InboundMessage[] }; reactions?: ChangedReaction[]; deleted?: ForgottenMessage[] }
): Promise<number> {
  const stored = change.messages?.stored ?? []
  const reactions = change.reactions ?? []
  const deleted = change.deleted ?? []
  if (!stored.length && !reactions.length && !deleted.length) return 0
  if (!(await hasWebhooks(ctx.sql, conn.id))) return 0
  const [{ handle } = { handle: null }] = await ctx.sql<{ handle: string | null }>(`select handle from parley.connection where id = $1`, [conn.id])
  const chats = await chatsOf(ctx.sql, conn.id, [...stored.map((m) => m.chatId), ...reactions.map((r) => r.chatId), ...deleted.map((m) => m.chatId)])
  const events: WebhookEventInput[] = []
  const base = ctx.config.publicUrl

  const byKey = new Map((change.messages?.inbound ?? []).map((m) => [`${m.threadId}\n${m.id}`, m]))
  for (const k of stored) {
    const m = byKey.get(`${k.chatId}\n${k.id}`)
    if (!m) continue
    let media: Record<string, unknown> | undefined
    if (m.media) {
      media = {
        kind: m.media.kind, mimetype: m.media.mimetype, file_name: m.media.fileName ?? null, size: m.media.size ?? null,
        width: m.media.width ?? null, height: m.media.height ?? null, seconds: m.media.seconds ?? null,
      }
      // The file itself, by the same expiring link get_media hands out (an hour; retries come well within it).
      if (base) {
        const link = await signMediaLink(ctx.config.signInKey, { accountId: conn.accountId, connectionId: conn.id, chatId: m.threadId, messageId: m.id })
        media.download_url = `${base}/media/${link.token}`
        media.download_expires_at = link.expiresAt
      }
    }
    events.push({
      type: m.fromMe ? "message.sent" : "message.received",
      data: {
        chat: chatOut(chats, m.threadId),
        message: { id: m.id, from: m.fromMe ? "me" : m.from, from_me: Boolean(m.fromMe), text: m.text, at: m.at, ...(media ? { media } : {}) },
      },
    })
  }
  for (const r of reactions) {
    events.push({
      type: r.emoji ? "reaction.added" : "reaction.removed",
      data: {
        chat: chatOut(chats, r.chatId),
        reaction: { from: r.from, from_me: r.fromMe, emoji: r.emoji, previous_emoji: r.before || null, at: r.at },
        message: { id: r.messageId, from: r.message.fromMe ? "me" : r.message.sender, from_me: r.message.fromMe, text: r.message.text },
      },
    })
  }
  for (const m of deleted) {
    // What it said stays deleted: the event names the message, not its text.
    events.push({ type: "message.deleted", data: { chat: chatOut(chats, m.chatId), message: { id: m.id, from: m.fromMe ? "me" : m.sender, from_me: m.fromMe, at: m.at } } })
  }
  return queueEvents(ctx.sql, { id: conn.id, channel: conn.channel, account: accountLabel({ handle }) }, events)
}
