import type { Sql } from "@parley/auth/db"

/** CRUD for `parley.connection`. Channel-neutral — `channel` is text and never switched on here. */

export type ConnectionStatus = "linking" | "connected" | "logged_out" | "closed" | "error"
export type Connection = {
  id: string; accountId: string; channel: string; status: ConnectionStatus; handle: string | null; displayName: string | null; createdAt: string; linkedAt: string | null; chatsChosen: boolean
  /** The link-time history sync: when it started, how far along (0–100, if known), and when it settled. */
  history: { startedAt: string | null; progress: number | null; doneAt: string | null }
  timezone: string; country: string | null; haltedReason: string | null; pausedUntil: string | null
}
/** Where the account appears to live: its active hours follow the time zone, its exit IP the country. */
export type Locale = { timezone?: string | undefined; country?: string | undefined }

type Row = {
  id: string; account_id: string; channel: string; status: ConnectionStatus; handle: string | null; display_name: string | null; created_at: Date; linked_at: Date | null; chats_chosen_at: Date | null
  history_started_at: Date | null; history_progress: number | null; history_done_at: Date | null
  timezone: string; country: string | null; halted_reason: string | null; paused_until: Date | null
}
const row = (r: Row): Connection => ({
  id: r.id, accountId: r.account_id, channel: r.channel, status: r.status, handle: r.handle, displayName: r.display_name,
  createdAt: r.created_at.toISOString(), linkedAt: r.linked_at ? r.linked_at.toISOString() : null, chatsChosen: r.chats_chosen_at !== null,
  history: { startedAt: r.history_started_at?.toISOString() ?? null, progress: r.history_progress ?? null, doneAt: r.history_done_at?.toISOString() ?? null },
  timezone: r.timezone, country: r.country, haltedReason: r.halted_reason, pausedUntil: r.paused_until && r.paused_until > new Date() ? r.paused_until.toISOString() : null,
})
const COLUMNS = "id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at, history_started_at, history_progress, history_done_at, timezone, country, halted_reason, paused_until"

export async function createConnection(sql: Sql, accountId: string, channel: string, locale: Locale = {}): Promise<Connection> {
  const [r] = await sql<Row>(
    `insert into parley.connection (account_id, channel, timezone, country) values ($1, $2, coalesce($3, 'UTC'), $4) returning ${COLUMNS}`,
    [accountId, channel, locale.timezone ?? null, locale.country?.toUpperCase() ?? null]
  )
  return row(r!)
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
