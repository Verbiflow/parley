import type { Sql } from "@parley/auth/db"

/** CRUD for `parley.connection`. Channel-neutral — `channel` is text and never switched on here. */

export type ConnectionStatus = "linking" | "connected" | "logged_out" | "closed" | "error"
export type Connection = { id: string; accountId: string; channel: string; status: ConnectionStatus; handle: string | null; displayName: string | null; createdAt: string; linkedAt: string | null; chatsChosen: boolean }

type Row = { id: string; account_id: string; channel: string; status: ConnectionStatus; handle: string | null; display_name: string | null; created_at: Date; linked_at: Date | null; chats_chosen_at: Date | null }
const row = (r: Row): Connection => ({
  id: r.id, accountId: r.account_id, channel: r.channel, status: r.status, handle: r.handle, displayName: r.display_name,
  createdAt: r.created_at.toISOString(), linkedAt: r.linked_at ? r.linked_at.toISOString() : null, chatsChosen: r.chats_chosen_at !== null,
})

export async function createConnection(sql: Sql, accountId: string, channel: string): Promise<Connection> {
  const [r] = await sql<Row>(
    `insert into parley.connection (account_id, channel) values ($1, $2)
     returning id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at`,
    [accountId, channel]
  )
  return row(r!)
}

export async function getConnection(sql: Sql, id: string): Promise<Connection | undefined> {
  const [r] = await sql<Row>(
    `select id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at from parley.connection where id = $1`,
    [id]
  )
  return r && row(r)
}

export async function listConnections(sql: Sql, accountId: string): Promise<Connection[]> {
  const rows = await sql<Row>(
    `select id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at from parley.connection
     where account_id = $1 order by created_at desc`,
    [accountId]
  )
  return rows.map(row)
}

/** Every live connection across all accounts — used to re-open sockets on boot. */
export async function connectedConnections(sql: Sql): Promise<Connection[]> {
  const rows = await sql<Row>(
    `select id, account_id, channel, status, handle, display_name, created_at, linked_at, chats_chosen_at from parley.connection where status = 'connected'`
  )
  return rows.map(row)
}

export async function markConnected(sql: Sql, id: string, handle: string): Promise<void> {
  await sql(`update parley.connection set status = 'connected', handle = $2, linked_at = coalesce(linked_at, now()), updated_at = now() where id = $1`, [id, handle])
}

export async function setStatus(sql: Sql, id: string, status: ConnectionStatus): Promise<void> {
  await sql(`update parley.connection set status = $2, updated_at = now() where id = $1`, [id, status])
}
