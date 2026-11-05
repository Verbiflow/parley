import type { Sql } from "@parley/auth/db"
import { moveWebhooks } from "./webhooks.ts"

/** CRUD for `parley.connection`. Channel-neutral — `channel` is text and never switched on here. */

export type ConnectionStatus = "linking" | "connected" | "logged_out" | "closed" | "error"
export type Connection = {
  id: string; accountId: string; channel: string; status: ConnectionStatus; handle: string | null; displayName: string | null; createdAt: string; linkedAt: string | null; chatsChosen: boolean
  /** The link-time history sync: when it started, how far along (0–100, if known), and when it settled. */
  history: { startedAt: string | null; progress: number | null; doneAt: string | null }
  timezone: string; country: string | null; haltedReason: string | null; pausedUntil: string | null
  /** Sends a local day may hold, every kind together. */
  dailyLimit: number
  /**
   * How agents behave on this number, both on unless the person turns them off: reading a chat marks it read on the
   * channel too (blue ticks, if the number's own WhatsApp setting allows), and a message shows "typing…" first. An
   * agent can skip either on a call, never turn one on that's off here.
   */
  readReceipts: boolean
  /** The number's own profile picture (a small `data:` image URL), null when it has none or we haven't seen it yet. */
  avatar: string | null
  typing: boolean
}
/**
 * Where the account appears to live (its active hours follow the time zone, its exit IP the country), and how many
 * messages it may send a day.
 */
export type Locale = { timezone?: string | undefined; country?: string | undefined; dailyLimit?: number | undefined }

type Row = {
  id: string; account_id: string; channel: string; status: ConnectionStatus; handle: string | null; display_name: string | null; created_at: Date; linked_at: Date | null; chats_chosen_at: Date | null
  history_started_at: Date | null; history_progress: number | null; history_done_at: Date | null
  timezone: string; country: string | null; halted_reason: string | null; paused_until: Date | null
  daily_limit: number
  read_receipts: boolean; typing: boolean
  avatar: string | null
}
const row = (r: Row): Connection => ({
  id: r.id, accountId: r.account_id, channel: r.channel, status: r.status, handle: r.handle, displayName: r.display_name,
  createdAt: r.created_at.toISOString(), linkedAt: r.linked_at ? r.linked_at.toISOString() : null, chatsChosen: r.chats_chosen_at !== null,
  history: { startedAt: r.history_started_at?.toISOString() ?? null, progress: r.history_progress ?? null, doneAt: r.history_done_at?.toISOString() ?? null },
  timezone: r.timezone, country: r.country, haltedReason: r.halted_reason, pausedUntil: r.paused_until && r.paused_until > new Date() ? r.paused_until.toISOString() : null,
  dailyLimit: r.daily_limit, readReceipts: r.read_receipts, typing: r.typing, avatar: r.avatar,
})
const COLUMNS = "id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at, history_started_at, history_progress, history_done_at, timezone, country, halted_reason, paused_until, daily_limit, read_receipts, typing, avatar"

export async function createConnection(sql: Sql, accountId: string, channel: string, locale: Locale = {}): Promise<Connection> {
  const [r] = await sql<Row>(
    `insert into parley.connection (account_id, channel, timezone, country) values ($1, $2, coalesce($3, 'UTC'), $4) returning ${COLUMNS}`,
    [accountId, channel, locale.timezone ?? null, locale.country?.toUpperCase() ?? null]
  )
  return row(r!)
}

/** Turn read receipts and typing on or off for one number. Only the account's own connections. */
export async function setBehaviour(sql: Sql, accountId: string, connectionId: string, b: { readReceipts: boolean; typing: boolean }): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    `update parley.connection set read_receipts = $3, typing = $4 where id = $2 and account_id = $1 returning id`,
    [accountId, connectionId, b.readReceipts, b.typing]
  )
  return rows.length > 0
}

export async function getConnection(sql: Sql, id: string): Promise<Connection | undefined> {
  const [r] = await sql<Row>(
    `select ${COLUMNS} from parley.connection where id = $1`,
    [id]
  )
  return r && row(r)
}

export async function listConnections(sql: Sql, accountId: string): Promise<Connection[]> {
  const rows = await sql<Row>(
    `select ${COLUMNS} from parley.connection where account_id = $1 order by created_at desc`,
    [accountId]
  )
  return rows.map(row)
}

/** Every live connection across all accounts — used to re-open sockets on boot. */
export async function connectedConnections(sql: Sql): Promise<Connection[]> {
  const rows = await sql<Row>(
    `select ${COLUMNS} from parley.connection where status = 'connected'`
  )
  return rows.map(row)
}

/** Live on the channel. A country learned from the handle (a phone number) fills in one the person didn't give. */
export async function markConnected(sql: Sql, id: string, handle: string, country?: string): Promise<void> {
  await sql(
    `update parley.connection set status = 'connected', handle = $2, country = coalesce(country, $3), linked_at = coalesce(linked_at, now()), updated_at = now() where id = $1`,
    [id, handle, country ?? null]
  )
}

/** The number's own profile picture, as the channel last saw it (null: it has none). */
export async function setAvatar(sql: Sql, id: string, image: string | null): Promise<void> {
  await sql(`update parley.connection set avatar = $2 where id = $1 and avatar is distinct from $2`, [id, image])
}

/** The account a handle names, without the device part: "6591363557:12@s.whatsapp.net" → "6591363557". */
const ACCOUNT_OF = (col: string) => `(case when ${col} like '%@%' then split_part(split_part(${col}, '@', 1), ':', 1) || '@' || split_part(${col}, '@', 2) else ${col} end)`

/**
 * Older links of the same account (same person, channel and number) as this freshly opened one — what linking a
 * number again replaces. The new link takes over what the old ones ignored, so relinking never un-ignores a chat.
 */
export async function supersede(sql: Sql, id: string): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    `select o.id from parley.connection n join parley.connection o
        on o.account_id = n.account_id and o.channel = n.channel and o.id <> n.id and o.created_at < n.created_at
       and o.status <> 'logged_out' and o.handle is not null and ${ACCOUNT_OF("o.handle")} = ${ACCOUNT_OF("n.handle")}
      where n.id = $1 and n.handle is not null`,
    [id]
  )
  if (rows.length) {
    await sql(
      `update parley.connection n set ignored_chats = coalesce((
         select jsonb_agg(distinct x) from (
           select jsonb_array_elements_text(n.ignored_chats) x
           union select jsonb_array_elements_text(o.ignored_chats) from parley.connection o where o.id = any($2::uuid[])
         ) s), '[]'::jsonb), updated_at = now()
       where n.id = $1`,
      [id, rows.map((r) => r.id)]
    )
    await moveWebhooks(sql, rows.map((r) => r.id), id)
  }
  return rows.map((r) => r.id)
}

/** Record the link-time history sync's progress. Progress only moves forward; `done` stamps when it settled. */
export async function setHistorySync(sql: Sql, id: string, progress: number | null, done: boolean): Promise<void> {
  await sql(
    `update parley.connection set
       history_started_at = coalesce(history_started_at, now()),
       history_progress = greatest(history_progress, $2::smallint),
       history_done_at = case when $3 then coalesce(history_done_at, now()) else history_done_at end,
       updated_at = now()
     where id = $1`,
    [id, progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))), done]
  )
}

export async function setStatus(sql: Sql, id: string, status: ConnectionStatus): Promise<void> {
  await sql(`update parley.connection set status = $2, updated_at = now() where id = $1`, [id, status])
}
