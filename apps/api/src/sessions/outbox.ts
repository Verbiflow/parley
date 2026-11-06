import type { Sql } from "@parley/auth"
import {
  ACTIONS, DAY, OUTCOME_POLICIES, REFUSED_OUTCOMES,
  backoffMs, defaultAction, localDate, planNext, policyFor, startOfNextLocalDay,
  type ActionKind, type Outcome, type PacingPolicy, type PlanResult, type Slot, type Wait,
} from "@parley/pacing"
import type { OutboundMedia } from "@parley/channels"
import type { Transactor } from "../db/transactor.ts"

/** Messages a connection may have waiting at once; past it, an agent is queueing faster than a person could ever send. */
export const MAX_QUEUED = 500
/** A claimed send must be reported within this, or its outcome is treated as unknown. */
export const LEASE_MS = 2 * 60_000
/** Sends that never reached the platform before a message is failed rather than retried again. */
export const MAX_TRANSPORT_ATTEMPTS = 5
const LOOKBACK_MS = 8 * DAY
/** Statuses whose slot the platform has seen, or will. */
const SLOT_STATUSES = ["scheduled", "sending", "sent"]

export class OutboxError extends Error {
  readonly code: "not_found" | "forbidden" | "action_unsupported" | "no_capacity" | "queue_full" | "not_cancelable" | "too_late"
  constructor(code: OutboxError["code"], message: string) {
    super(message)
    this.name = "OutboxError"
    this.code = code
  }
}

export type PacedConnection = {
  id: string; accountId: string; channel: string; status: string; timezone: string; country: string | null
  pausedUntil: Date | null; actionPauses: Partial<Record<ActionKind, string>>
  consecutiveRateLimits: number; haltedReason: string | null
  /** Sends a local day may hold, every kind together. The person sets it. */
  dailyLimit: number
  /** Send only inside the channel's local active hours. Off unless the person turns it on for this number. */
  activeHours: boolean
  /** Least seconds between two sends (up to twice that at random); null keeps the channel's default. The person sets it. */
  gapSeconds: number | null
}

type ConnRow = {
  id: string; account_id: string; channel: string; status: string; timezone: string; country: string | null
  paused_until: Date | null; action_pauses: Partial<Record<ActionKind, string>>; consecutive_rate_limits: number; halted_reason: string | null
  daily_limit: number; active_hours: boolean; gap_seconds: number | null
}
const CONN_COLUMNS = "id, account_id, channel, status, timezone, country, paused_until, action_pauses, consecutive_rate_limits, halted_reason, daily_limit, active_hours, gap_seconds"
const conn = (r: ConnRow): PacedConnection => ({
  id: r.id, accountId: r.account_id, channel: r.channel, status: r.status, timezone: r.timezone, country: r.country,
  pausedUntil: r.paused_until, actionPauses: r.action_pauses, consecutiveRateLimits: r.consecutive_rate_limits, haltedReason: r.halted_reason,
  dailyLimit: r.daily_limit, activeHours: r.active_hours, gapSeconds: r.gap_seconds,
})

/**
 * How long after sending a message the account can still delete it for everyone. WhatsApp allows about two and a half
 * days; staying under it leaves room for the deletion's own place in the queue.
 */
export const UNSEND_WINDOW_MS = 48 * 60 * 60 * 1000

export type OutboundStatus = "scheduled" | "sending" | "sent" | "failed" | "canceled"
/** What a queued file is. Its bytes stay in the database until it's sent; nothing that lists the outbox reads them. */
export type OutboundMediaInfo = { kind: OutboundMedia["kind"]; mimetype: string; fileName?: string | undefined; gif?: boolean | undefined }
export type Outbound = {
  id: string; connectionId: string; chatId: string; kind: ActionKind; text: string; status: OutboundStatus
  /** A file sent with `text` as its caption. */
  media: OutboundMediaInfo | null
  /** A reaction (`text` is the emoji; empty takes it back) to this message id. */
  reactTo: string | null
  /** A deletion, for everyone, of this sent message (the channel's id for it). */
  unsend: string | null
  /** The chat shows the account typing for a moment before it goes. */
  typing: boolean
  scheduledFor: string | null; sentAt: string | null; attempts: number; error: { code: string; message: string } | null; createdAt: string
}
type OutRow = {
  id: string; connection_id: string; chat_id: string; kind: ActionKind; body: string; status: OutboundStatus; scheduled_for: Date | null
  not_before: Date | null; sent_at: Date | null; attempts: number; error_code: string | null; error_message: string | null; created_at: Date
  media: OutboundMediaInfo | null; react_to: string | null; unsend: string | null; typing: boolean
}
const OUT_COLUMNS = "id, connection_id, chat_id, kind, body, status, scheduled_for, not_before, sent_at, attempts, error_code, error_message, created_at, media, react_to, unsend, typing"
const outbound = (r: OutRow): Outbound => ({
  id: r.id, connectionId: r.connection_id, chatId: r.chat_id, kind: r.kind, text: r.body, status: r.status,
  media: r.media ?? null, reactTo: r.react_to ?? null, unsend: r.unsend ?? null, typing: r.typing,
  scheduledFor: r.status === "scheduled" ? (r.scheduled_for?.toISOString() ?? null) : null,
  sentAt: r.sent_at?.toISOString() ?? null, attempts: r.attempts,
  error: r.error_code ? { code: r.error_code, message: r.error_message ?? r.error_code } : null, createdAt: r.created_at.toISOString(),
})

/** Halted connections, and ones not live on the channel, keep their queue but send nothing until a person acts. */
const halted = (c: PacedConnection) => c.status !== "connected" || c.haltedReason !== null

export async function lockConnection(sql: Sql, id: string): Promise<PacedConnection | undefined> {
  const [r] = await sql<ConnRow>(`select ${CONN_COLUMNS} from parley.connection where id = $1 for update`, [id])
  return r && conn(r)
}

async function readConnection(sql: Sql, id: string): Promise<PacedConnection | undefined> {
  const [r] = await sql<ConnRow>(`select ${CONN_COLUMNS} from parley.connection where id = $1`, [id])
  return r && conn(r)
}

async function owned(sql: Sql, accountId: string, connectionId: string, lock: boolean): Promise<PacedConnection> {
  const c = lock ? await lockConnection(sql, connectionId) : await readConnection(sql, connectionId)
  if (!c) throw new OutboxError("not_found", "no such connection")
  if (c.accountId !== accountId) throw new OutboxError("forbidden", "not your connection")
  return c
}

/** Every slot the platform has seen or will: queued and sent messages, plus refused attempts (activity, not quota). */
async function loadSlots(sql: Sql, connectionId: string, now: Date, opts: { settledOnly?: boolean } = {}): Promise<Slot[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS)
  const statuses = opts.settledOnly ? SLOT_STATUSES.filter((s) => s !== "scheduled") : SLOT_STATUSES
  const rows = await sql<{ kind: ActionKind; at: Date }>(
    `select kind, coalesce(sent_at, scheduled_for) as at from parley.outbound
      where connection_id = $1 and status = any($2) and coalesce(sent_at, scheduled_for) > $3`,
    [connectionId, statuses, since]
  )
  const refused = await sql<{ kind: ActionKind; at: Date }>(
    `select kind, at from parley.connection_event where connection_id = $1 and kind is not null and outcome = any($2) and at > $3`,
    [connectionId, REFUSED_OUTCOMES, since]
  )
  return [...rows.map((r) => ({ at: r.at, action: r.kind })), ...refused.map((r) => ({ at: r.at, action: r.kind, activityOnly: true }))]
}

type Context = { policy: PacingPolicy; slots: Slot[] }

/** The one daily limit (`dailyLimit`) replaced the per-kind warmup ramp; pushback still pauses and backs off. */
function pacingContext(c: PacedConnection, slots: Slot[]): Context {
  const policy = policyFor(c.channel)
  if (c.gapSeconds === null) return { policy, slots }
  return { policy: { ...policy, gapSeconds: { min: c.gapSeconds, max: c.gapSeconds * 2 } }, slots }
}

function plan(c: PacedConnection, ctx: Context, action: ActionKind, now: Date, notBefore?: Date | null): PlanResult {
  const pause = c.actionPauses[action] ? new Date(c.actionPauses[action]!) : null
  const pausedUntil = [c.pausedUntil, notBefore, pause].reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null)
  return planNext(
    { policy: ctx.policy, timeZone: c.timezone, seed: c.id, now, reservations: ctx.slots, pausedUntil, pausedIndefinitely: halted(c), dailyTotal: c.dailyLimit, activeHours: c.activeHours },
    action
  )
}

export type Queued = Outbound & { waits: Wait[]; held: boolean }

export type EnqueueRequest = {
  accountId: string; connectionId: string; to: string; text: string; kind?: ActionKind | undefined; notBefore?: Date | undefined
  idempotencyKey?: string | undefined; agentSessionId?: string | undefined
  /** Send this file, with `text` as its caption. */
  media?: (OutboundMediaInfo & { data: Uint8Array }) | undefined
  /** React to this stored message with `text` (an emoji; empty takes the reaction back). Paced as a reply. */
  reactTo?: string | undefined
  /** Delete this sent message (the channel's id for it) for everyone; `text` is empty. Paced as a reply. */
  unsend?: string | undefined
  /** The platform stops honouring the deletion after this: refuse it if its slot would land later. */
  unsendBefore?: Date | undefined
  /** Show the account typing (recording, for a voice note) before it goes, as a person would. Not for reactions or deletions. */
  typing?: boolean | undefined
}

/**
 * Queue a message on a connection: decide what it costs the account (a reply, or opening a conversation), then
 * reserve the connection's next human-paced slot for it. The connection row is locked for the duration, so two
 * concurrent sends queue one behind the other instead of landing on the same slot.
 */
export async function enqueue(
  tx: Transactor,
  req: EnqueueRequest,
  now: Date
): Promise<{ message: Queued; replayed: boolean }> {
  return tx.transaction(async (sql) => {
    const c = await owned(sql, req.accountId, req.connectionId, true)
    if (req.idempotencyKey) {
      const [dupe] = await sql<OutRow>(`select ${OUT_COLUMNS} from parley.outbound where connection_id = $1 and idempotency_key = $2`, [c.id, req.idempotencyKey])
      if (dupe) return { message: { ...outbound(dupe), waits: [], held: dupe.status === "scheduled" && !dupe.scheduled_for }, replayed: true }
    }
    const [backlog] = await sql<{ n: number }>(`select count(*)::int as n from parley.outbound where connection_id = $1 and status = 'scheduled'`, [c.id])
    if ((backlog?.n ?? 0) >= MAX_QUEUED) throw new OutboxError("queue_full", `this connection already has ${MAX_QUEUED} messages waiting to send`)

    const [hidden] = await sql<{ yes: boolean }>(
      `select exists (select 1 from parley.chat where connection_id = $1 and id = $2 and not synced)
           or jsonb_exists((select ignored_chats from parley.connection where id = $1), $2) as yes`,
      [c.id, req.to]
    )
    if (hidden?.yes) throw new OutboxError("forbidden", "the account holder ignored this chat in Parley, so agents can't send, react or delete in it")
    const [known] = await sql<{ yes: boolean }>(
      `select exists (select 1 from parley.chat where connection_id = $1 and id = $2 and last_message_at is not null)
           or exists (select 1 from parley.outbound where connection_id = $1 and chat_id = $2 and status = 'sent') as yes`,
      [c.id, req.to]
    )
    // A reaction or a deletion is a reply in a conversation that's already going, whatever was asked.
    const kind = req.reactTo || req.unsend ? "message" : req.kind ?? defaultAction(c.channel, Boolean(known?.yes))
    if (!policyFor(c.channel).actions[kind]) throw new OutboxError("action_unsupported", `${c.channel} can't send a ${kind}`)

    const ctx = pacingContext(c, await loadSlots(sql, c.id, now))
    const r = plan(c, ctx, kind, now, req.notBefore)
    if (!r.ok && r.reason !== "paused") throw new OutboxError(r.reason, r.reason === "no_capacity" ? `no capacity left for a ${kind} on this connection` : `${c.channel} can't send a ${kind}`)
    if (req.unsendBefore && r.ok && r.at > req.unsendBefore) {
      throw new OutboxError("too_late", `the account's next send slot (${r.at.toISOString()}) is past ${c.channel}'s limit for deleting that message (${req.unsendBefore.toISOString()})`)
    }

    const [row] = await sql<OutRow>(
      `insert into parley.outbound (connection_id, chat_id, kind, body, scheduled_for, not_before, idempotency_key, agent_session_id, created_at, media, media_data, react_to, unsend, typing)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning ${OUT_COLUMNS}`,
      [c.id, req.to, kind, req.text, r.ok ? r.at : null, req.notBefore ?? null, req.idempotencyKey ?? null, req.agentSessionId ?? null, now,
        req.media ? JSON.stringify({ kind: req.media.kind, mimetype: req.media.mimetype, ...(req.media.fileName ? { fileName: req.media.fileName } : {}), ...(req.media.gif ? { gif: true } : {}) }) : null,
        req.media ? Buffer.from(req.media.data) : null, req.reactTo ?? null, req.unsend ?? null, Boolean(req.typing && !req.reactTo && !req.unsend)]
    )
    return { message: { ...outbound(row!), waits: r.ok ? r.waits : ["paused"], held: !r.ok }, replayed: false }
  })
}

/**
 * Lay the connection's queue out again, in order, behind what has actually been sent. Run after anything that moves
 * its clock: a send finishing, a pause, a resume, the connection coming back online.
 */
export async function replan(sql: Sql, c: PacedConnection, now: Date): Promise<void> {
  const queued = await sql<{ id: string; kind: ActionKind; not_before: Date | null }>(
    `select id, kind, not_before from parley.outbound where connection_id = $1 and status = 'scheduled'
      order by scheduled_for asc nulls last, created_at asc`,
    [c.id]
  )
  if (!queued.length) return
  const ctx = pacingContext(c, await loadSlots(sql, c.id, now, { settledOnly: true }))
  for (const m of queued) {
    const r = plan(c, ctx, m.kind, now, m.not_before)
    await sql(`update parley.outbound set scheduled_for = $2 where id = $1`, [m.id, r.ok ? r.at : null])
    if (r.ok) ctx.slots.push({ at: r.at, action: m.kind })
  }
}

export async function replanConnection(tx: Transactor, connectionId: string, now: Date): Promise<void> {
  await tx.transaction(async (sql) => {
    const c = await lockConnection(sql, connectionId)
    if (c) await replan(sql, c, now)
  })
}

export type Availability = Partial<Record<ActionKind, { canSendNow: boolean; earliestAt: string | null; waits: Wait[]; reason?: string; usedToday: number }>>
/** Today's sends on the connection, every kind together, against its daily limit. */
export type DailyUsage = { sentToday: number; dailyLimit: number }

/** When each action could next go out, without reserving anything: an agent's "can I send now?" */
export async function availability(sql: Sql, accountId: string, connectionId: string, now: Date): Promise<{ connection: PacedConnection; actions: Availability; today: DailyUsage }> {
  const c = await owned(sql, accountId, connectionId, false)
  const ctx = pacingContext(c, await loadSlots(sql, c.id, now))
  const today = localDate(now, c.timezone)
  const actions: Availability = {}
  for (const action of ACTIONS) {
    if (!ctx.policy.actions[action]) continue
    const r = plan(c, ctx, action, now)
    const usedToday = ctx.slots.filter((s) => s.action === action && !s.activityOnly && s.at <= now && localDate(s.at, c.timezone) === today).length
    actions[action] = r.ok
      ? { canSendNow: r.at <= now, earliestAt: r.at.toISOString(), waits: r.waits, usedToday }
      : { canSendNow: false, earliestAt: null, waits: [], reason: r.reason, usedToday }
  }
  const sentToday = ctx.slots.filter((s) => !s.activityOnly && s.at <= now && localDate(s.at, c.timezone) === today).length
  return { connection: c, actions, today: { sentToday, dailyLimit: c.dailyLimit } }
}

export type Claimed = {
  id: string; connectionId: string; chatId: string; kind: ActionKind; text: string; attempts: number
  media?: OutboundMedia | undefined; reactTo?: string | undefined; unsend?: string | undefined; typing: boolean
}

/**
 * Take the due messages for these (live, locally held) connections: at most one per connection per call, so a
 * connection that fell behind catches up at its own pace instead of firing its backlog at once.
 */
export async function claimDue(tx: Transactor, connectionIds: string[], now: Date): Promise<Claimed[]> {
  if (!connectionIds.length) return []
  return tx.transaction(async (sql) => {
    const rows = await sql<{ id: string; connection_id: string; chat_id: string; kind: ActionKind; body: string; attempts: number; media: OutboundMediaInfo | null; media_data: Uint8Array | null; react_to: string | null; unsend: string | null; typing: boolean }>(
      `select o.id, o.connection_id, o.chat_id, o.kind, o.body, o.attempts, o.media, o.media_data, o.react_to, o.unsend, o.typing from parley.outbound o
        where o.status = 'scheduled' and o.id in (
          select distinct on (d.connection_id) d.id
            from parley.outbound d join parley.connection k on k.id = d.connection_id
           where d.status = 'scheduled' and d.scheduled_for <= $2 and d.connection_id = any($1::uuid[])
             and k.status = 'connected' and k.halted_reason is null and (k.paused_until is null or k.paused_until <= $2)
             and not exists (select 1 from parley.outbound s where s.connection_id = d.connection_id and s.status = 'sending')
           order by d.connection_id, d.scheduled_for)
        for update of o skip locked`,
      [connectionIds, now]
    )
    if (!rows.length) return []
    await sql(`update parley.outbound set status = 'sending', attempts = attempts + 1, lease_expires_at = $2 where id = any($1::uuid[])`, [rows.map((r) => r.id), new Date(now.getTime() + LEASE_MS)])
    return rows.map((r) => ({
      id: r.id, connectionId: r.connection_id, chatId: r.chat_id, kind: r.kind, text: r.body, attempts: r.attempts + 1, typing: r.typing,
      ...(r.media && r.media_data ? { media: { ...r.media, data: new Uint8Array(r.media_data) } } : {}),
      ...(r.react_to ? { reactTo: r.react_to } : {}),
      ...(r.unsend ? { unsend: r.unsend } : {}),
    }))
  })
}

export type Reported = { message: Outbound; connection: PacedConnection; changed: boolean }

/**
 * Apply what the platform said. `OUTCOME_POLICIES` decides; this carries it out: settle or requeue the message,
 * pause the connection or the action, and lay the rest of the queue out again.
 */
export async function report(tx: Transactor, id: string, result: { outcome: Outcome; externalId?: string | undefined; detail?: string | undefined }, now: Date): Promise<Reported> {
  return tx.transaction(async (sql) => {
    // Lock order everywhere: the connection, then its messages.
    const [ref] = await sql<{ connection_id: string }>(`select connection_id from parley.outbound where id = $1`, [id])
    if (!ref) throw new OutboxError("not_found", "no such message")
    const c = (await lockConnection(sql, ref.connection_id))!
    const [m] = await sql<OutRow>(`select ${OUT_COLUMNS} from parley.outbound where id = $1 for update`, [id])
    if (!m) throw new OutboxError("not_found", "no such message")
    const { outcome } = result
    const policy = OUTCOME_POLICIES[outcome]
    await sql(`insert into parley.connection_event (connection_id, kind, outcome, outbound_id, detail, at) values ($1, $2, $3, $4, $5, $6)`, [c.id, m.kind, outcome, m.id, result.detail?.slice(0, 500) ?? null, now])

    const exhausted = outcome === "transport_error" && m.attempts >= MAX_TRANSPORT_ATTEMPTS
    if (outcome === "sent") {
      await sql(`update parley.outbound set status = 'sent', sent_at = $2, external_id = $3, lease_expires_at = null, media_data = null where id = $1`, [m.id, now, result.externalId ?? null])
    } else if (policy.retry && !exhausted) {
      await sql(`update parley.outbound set status = 'scheduled', scheduled_for = null, lease_expires_at = null where id = $1`, [m.id])
    } else {
      const [code, message] = exhausted ? ["too_many_attempts", `gave up after ${m.attempts} attempts that never reached ${c.channel}`] : [outcome, result.detail ?? outcome]
      await sql(`update parley.outbound set status = 'failed', error_code = $2, error_message = $3, lease_expires_at = null, media_data = null where id = $1`, [m.id, code, message.slice(0, 500)])
    }

    let next = c
    const set: string[] = []
    const values: unknown[] = [c.id]
    const put = (column: string, value: unknown) => {
      values.push(value)
      set.push(`${column} = $${values.length}`)
    }
    if (outcome === "rate_limited") {
      const n = c.consecutiveRateLimits + 1
      put("consecutive_rate_limits", n)
      put("paused_until", new Date(now.getTime() + backoffMs(n, c.id)))
    } else if (outcome === "sent" && c.consecutiveRateLimits > 0) {
      put("consecutive_rate_limits", 0)
    }
    if (policy.pause?.scope === "action") put("action_pauses", JSON.stringify({ ...c.actionPauses, [m.kind]: startOfNextLocalDay(now, c.timezone).toISOString() }))
    if (policy.pause?.until === "human") put("halted_reason", outcome)
    if (set.length) {
      const [r] = await sql<ConnRow>(`update parley.connection set ${set.join(", ")}, updated_at = now() where id = $1 returning ${CONN_COLUMNS}`, values)
      next = conn(r!)
    }
    await replan(sql, next, now)
    const [settled] = await sql<OutRow>(`select ${OUT_COLUMNS} from parley.outbound where id = $1`, [m.id])
    return { message: outbound(settled!), connection: next, changed: set.some((s) => !s.startsWith("consecutive_rate_limits")) }
  })
}

/**
 * A send whose worker stopped answering may or may not have reached the platform. Sending it again could message
 * someone twice, so it fails as `outcome_unknown` and the agent decides.
 */
export async function expireLeases(tx: Transactor, now: Date): Promise<number> {
  return tx.transaction(async (sql) => {
    const rows = await sql<{ id: string }>(
      `update parley.outbound set status = 'failed', lease_expires_at = null, media_data = null, error_code = 'outcome_unknown',
              error_message = 'The send was interrupted; check the conversation before sending again'
        where status = 'sending' and lease_expires_at < $1 returning id`,
      [now]
    )
    return rows.length
  })
}

/**
 * Fail a claimed message without it reaching the platform: something it needed stopped being true while it waited
 * (a deletion past the platform's limit). Nothing was attempted, so pacing hears nothing; the queue moves up.
 */
export async function abandon(tx: Transactor, id: string, code: string, message: string, now: Date): Promise<void> {
  await tx.transaction(async (sql) => {
    const [ref] = await sql<{ connection_id: string }>(`select connection_id from parley.outbound where id = $1`, [id])
    if (!ref) return
    const c = (await lockConnection(sql, ref.connection_id))!
    await sql(
      `update parley.outbound set status = 'failed', error_code = $2, error_message = $3, lease_expires_at = null, media_data = null where id = $1 and status = 'sending'`,
      [id, code.slice(0, 60), message.slice(0, 500)]
    )
    await replan(sql, c, now)
  })
}

export async function cancel(tx: Transactor, accountId: string, id: string, now: Date): Promise<Outbound> {
  return tx.transaction(async (sql) => {
    const [ref] = await sql<{ connection_id: string; account_id: string }>(
      `select o.connection_id, k.account_id from parley.outbound o join parley.connection k on k.id = o.connection_id where o.id = $1`,
      [id]
    )
    if (!ref || ref.account_id !== accountId) throw new OutboxError("not_found", "no such message")
    const c = (await lockConnection(sql, ref.connection_id))!
    const [m] = await sql<OutRow>(`select ${OUT_COLUMNS} from parley.outbound where id = $1 for update`, [id])
    if (m!.status !== "scheduled") throw new OutboxError("not_cancelable", `the message is ${m!.status}; only scheduled messages can be canceled`)
    const [row] = await sql<OutRow>(`update parley.outbound set status = 'canceled', scheduled_for = null, media_data = null where id = $1 returning ${OUT_COLUMNS}`, [id])
    await replan(sql, c, now)
    return outbound(row!)
  })
}

/** Clear a halt or a pause once a person has dealt with its cause (solved the checkpoint, relinked). */
export async function resume(tx: Transactor, accountId: string, connectionId: string, now: Date): Promise<PacedConnection> {
  return tx.transaction(async (sql) => {
    await owned(sql, accountId, connectionId, true)
    const [r] = await sql<ConnRow>(
      `update parley.connection set halted_reason = null, paused_until = null, action_pauses = '{}', consecutive_rate_limits = 0, updated_at = now()
        where id = $1 returning ${CONN_COLUMNS}`,
      [connectionId]
    )
    const c = conn(r!)
    await replan(sql, c, now)
    return c
  })
}

/** Highest daily limit a person can set; past it no account sends like a person. */
export const MAX_DAILY_LIMIT = 1000
/** Longest gap a person can set between two sends. */
export const MAX_GAP_SECONDS = 3600

/**
 * Set where the account appears to live (its active hours, when on, follow this time zone), how many messages it may
 * send a day, whether it keeps to active hours, and the gap between sends (`gapSeconds`: null for the channel's
 * default, left out to keep it). The queue is laid out again, so a lower limit pushes the overflow to tomorrow and a
 * higher one pulls it in; turning active hours off pulls overnight sends in; a shorter gap pulls the queue closer.
 */
export async function setLocale(tx: Transactor, accountId: string, connectionId: string, locale: { timezone?: string | undefined; country?: string | undefined; dailyLimit?: number | undefined; activeHours?: boolean | undefined; gapSeconds?: number | null | undefined }, now: Date): Promise<void> {
  const limit = locale.dailyLimit !== undefined && Number.isInteger(locale.dailyLimit) && locale.dailyLimit >= 1 && locale.dailyLimit <= MAX_DAILY_LIMIT ? locale.dailyLimit : null
  const g = locale.gapSeconds
  const setGap = g === null || (Number.isInteger(g) && g! >= 0 && g! <= MAX_GAP_SECONDS)
  await tx.transaction(async (sql) => {
    await owned(sql, accountId, connectionId, true)
    const [r] = await sql<ConnRow>(
      `update parley.connection set timezone = coalesce($2, timezone), country = coalesce($3, country), daily_limit = coalesce($4, daily_limit), active_hours = coalesce($5, active_hours),
             gap_seconds = case when $6 then $7::int else gap_seconds end, updated_at = now()
        where id = $1 returning ${CONN_COLUMNS}`,
      [connectionId, locale.timezone ?? null, locale.country ?? null, limit, typeof locale.activeHours === "boolean" ? locale.activeHours : null, setGap, setGap ? g : null]
    )
    await replan(sql, conn(r!), now)
  })
}

export async function getOutbound(sql: Sql, accountId: string, id: string): Promise<Outbound> {
  const [m] = await sql<OutRow & { account_id: string }>(
    `select ${OUT_COLUMNS.split(", ").map((c) => `o.${c}`).join(", ")}, k.account_id from parley.outbound o join parley.connection k on k.id = o.connection_id where o.id = $1`,
    [id]
  )
  if (!m || m.account_id !== accountId) throw new OutboxError("not_found", "no such message")
  return outbound(m)
}

export async function listOutbound(
  sql: Sql, accountId: string, opts: { connectionId?: string | undefined; status?: OutboundStatus | undefined; limit: number }
): Promise<Outbound[]> {
  const rows = await sql<OutRow>(
    `select ${OUT_COLUMNS.split(", ").map((c) => `o.${c}`).join(", ")} from parley.outbound o join parley.connection k on k.id = o.connection_id
      where k.account_id = $1 and ($2::uuid is null or o.connection_id = $2) and ($3::text is null or o.status = $3)
      order by case when o.status = 'scheduled' then 0 else 1 end, coalesce(o.scheduled_for, o.sent_at, o.created_at) ${opts.status === "scheduled" ? "asc" : "desc"}
      limit $4`,
    [accountId, opts.connectionId ?? null, opts.status ?? null, opts.limit]
  )
  return rows.map(outbound)
}

/** One line of the activity log: the send, when it last moved (sent, or asked for), and the agent that asked for it. */
export type ActivityEntry = Outbound & { at: string; agent: string | null }
export type ActivityStatus = "sent" | "queued" | "failed" | "canceled"
export type ActivityPage = { entries: ActivityEntry[]; total: number; counts: Record<ActivityStatus | "all", number> }
const ACTIVITY_STATUSES: Record<ActivityStatus, OutboundStatus[]> = { sent: ["sent"], queued: ["scheduled", "sending"], failed: ["failed"], canceled: ["canceled"] }

/**
 * The account's activity log, newest first: every send its agents asked for, filtered by state, account and a search
 * over the text and recipient. `counts` ignores the state filter, so each state's tab can say how many it holds.
 */
export async function listActivity(
  sql: Sql, accountId: string,
  opts: { status?: ActivityStatus | undefined; connectionId?: string | undefined; q?: string | undefined; limit: number; offset: number }
): Promise<ActivityPage> {
  const q = opts.q?.trim().slice(0, 200) || null
  const like = q && `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const digits = q?.replace(/\D/g, "") ?? ""
  const filter = `k.account_id = $1 and ($2::uuid is null or o.connection_id = $2)
    and ($3::text is null or o.body ilike $3 or ($4::text is not null and o.chat_id like $4))`
  const args = [accountId, opts.connectionId ?? null, like, digits.length >= 3 ? `%${digits}%` : null]
  const [rows, counts] = await Promise.all([
    sql<OutRow & { at: Date; agent: string | null }>(
      `select ${OUT_COLUMNS.split(", ").map((c) => `o.${c}`).join(", ")}, coalesce(o.sent_at, o.created_at) as at, a.client_name as agent
         from parley.outbound o join parley.connection k on k.id = o.connection_id
         left join lateral (select c.client_name from oauth.refresh_token r join oauth.client c using (client_id)
                             where r.session_id = o.agent_session_id order by r.created_at limit 1) a on o.agent_session_id is not null
        where ${filter} and ($5::text[] is null or o.status = any($5))
        order by coalesce(o.sent_at, o.created_at) desc, o.id desc
        limit $6 offset $7`,
      [...args, opts.status ? ACTIVITY_STATUSES[opts.status] : null, opts.limit, opts.offset]
    ),
    sql<{ status: OutboundStatus; n: string }>(
      `select o.status, count(*)::text as n from parley.outbound o join parley.connection k on k.id = o.connection_id where ${filter} group by o.status`,
      args
    ),
  ])
  const by = new Map(counts.map((r) => [r.status, Number(r.n)]))
  const tally = (s: OutboundStatus[]) => s.reduce((n, x) => n + (by.get(x) ?? 0), 0)
  const all = { all: tally(["scheduled", "sending", "sent", "failed", "canceled"]), sent: tally(["sent"]), queued: tally(["scheduled", "sending"]), failed: tally(["failed"]), canceled: tally(["canceled"]) }
  return {
    entries: rows.map((r) => ({ ...outbound(r), at: r.at.toISOString(), agent: r.agent })),
    total: opts.status ? all[opts.status] : all.all,
    counts: all,
  }
}
