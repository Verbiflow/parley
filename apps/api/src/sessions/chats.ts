import type { Sql } from "@parley/auth/db"
import type { Chat, InboundMessage } from "@parley/channels"

/** CRUD for `parley.chat` / `parley.message`: the chats on a connection, which are synced, and synced messages. */

export type ChatRow = { id: string; kind: "direct" | "group"; name: string | null; synced: boolean; lastMessageAt: string | null }
export type StoredMessage = { id: string; chatId: string; sender: string; fromMe: boolean; text: string; at: string }

type Raw = { id: string; kind: "direct" | "group"; name: string | null; synced: boolean; last_message_at: Date | null }
const chatRow = (r: Raw): ChatRow => ({ id: r.id, kind: r.kind, name: r.name, synced: r.synced, lastMessageAt: r.last_message_at?.toISOString() ?? null })

/** Upsert chats the channel reported. A known name is never blanked, and last activity only moves forward. */
export async function upsertChats(sql: Sql, connectionId: string, chats: Chat[]): Promise<void> {
  if (!chats.length) return
  await sql(
    `insert into parley.chat (connection_id, id, kind, name, last_message_at)
     select $1, c.id, c.kind, nullif(left(c.name, 200), ''), c.at
       from jsonb_to_recordset($2::jsonb) as c(id text, kind text, name text, at timestamptz)
     on conflict (connection_id, id) do update set
       kind = excluded.kind,
       name = coalesce(excluded.name, parley.chat.name),
       last_message_at = greatest(parley.chat.last_message_at, excluded.last_message_at),
       updated_at = now()`,
    [connectionId, JSON.stringify(chats.map((c) => ({ id: c.id, kind: c.kind, name: c.name, at: c.lastMessageAt ?? null })))]
  )
}

/**
 * Record activity in a chat a message just arrived in. Channels normally report the chat first (with its kind and
 * name); if one didn't, it's listed as a direct chat until a `chats` event corrects it.
 */
export async function touchChat(sql: Sql, connectionId: string, chatId: string, at: string): Promise<void> {
  await sql(
    `insert into parley.chat (connection_id, id, kind, last_message_at) values ($1, $2, 'direct', $3)
     on conflict (connection_id, id) do update set last_message_at = greatest(parley.chat.last_message_at, excluded.last_message_at), updated_at = now()`,
    [connectionId, chatId, at]
  )
}

export async function listChats(sql: Sql, connectionId: string, opts: { syncedOnly?: boolean } = {}): Promise<ChatRow[]> {
  const rows = await sql<Raw>(
    `select id, kind, name, synced, last_message_at from parley.chat
      where connection_id = $1 ${opts.syncedOnly ? "and synced" : ""}
      order by last_message_at desc nulls last, name nulls last, id`,
    [connectionId]
  )
  return rows.map(chatRow)
}

export async function getChat(sql: Sql, connectionId: string, chatId: string): Promise<ChatRow | undefined> {
  const [r] = await sql<Raw>(`select id, kind, name, synced, last_message_at from parley.chat where connection_id = $1 and id = $2`, [connectionId, chatId])
  return r && chatRow(r)
}

/**
 * Make exactly `chatIds` the synced set. Chats turned off lose their stored messages. Returns the ids that were newly
 * turned on (so the caller can backfill them from history it's holding).
 */
export async function setSyncedChats(sql: Sql, connectionId: string, chatIds: string[]): Promise<string[]> {
  const ids = JSON.stringify(chatIds)
  const on = await sql<{ id: string }>(
    `update parley.chat set synced = true, updated_at = now()
      where connection_id = $1 and not synced and id in (select jsonb_array_elements_text($2::jsonb)) returning id`,
    [connectionId, ids]
  )
  await sql(
    `with off as (
       update parley.chat set synced = false, updated_at = now()
        where connection_id = $1 and synced and id not in (select jsonb_array_elements_text($2::jsonb)) returning id)
     delete from parley.message m using off where m.connection_id = $1 and m.chat_id = off.id`,
    [connectionId, ids]
  )
  await sql(`update parley.connection set chats_chosen_at = now(), updated_at = now() where id = $1`, [connectionId])
  return on.map((r) => r.id)
}

export async function chatsChosen(sql: Sql, connectionId: string): Promise<boolean> {
  const [r] = await sql<{ chosen: boolean }>(`select chats_chosen_at is not null as chosen from parley.connection where id = $1`, [connectionId])
  return Boolean(r?.chosen)
}

/** Store messages, but only those in synced chats (the filter is in the insert, so a race with un-syncing can't leak). */
export async function saveMessages(sql: Sql, connectionId: string, messages: InboundMessage[]): Promise<void> {
  if (!messages.length) return
  await sql(
    `insert into parley.message (connection_id, chat_id, id, sender, from_me, body, sent_at)
     select $1, m.chat_id, m.id, left(m.sender, 200), m.from_me, m.body, m.at
       from jsonb_array_elements($2::jsonb) with ordinality as e(v, ord),
            jsonb_to_record(e.v) as m(chat_id text, id text, sender text, from_me boolean, body text, at timestamptz)
       join parley.chat c on c.connection_id = $1 and c.id = m.chat_id and c.synced
      order by e.ord
     on conflict do nothing`,
    [connectionId, JSON.stringify(messages.map((m) => ({ chat_id: m.threadId, id: m.id, sender: m.from, from_me: Boolean(m.fromMe), body: m.text, at: m.at })))]
  )
}

export async function readMessages(sql: Sql, connectionId: string, chatId: string, opts: { limit: number; before?: string | undefined }): Promise<StoredMessage[]> {
  const rows = await sql<{ id: string; chat_id: string; sender: string; from_me: boolean; body: string; sent_at: Date }>(
    `select id, chat_id, sender, from_me, body, sent_at from parley.message
      where connection_id = $1 and chat_id = $2 and ($3::timestamptz is null or sent_at < $3)
      order by sent_at desc, seq desc limit $4`,
    [connectionId, chatId, opts.before ?? null, opts.limit]
  )
  return rows.reverse().map((r) => ({ id: r.id, chatId: r.chat_id, sender: r.sender, fromMe: r.from_me, text: r.body, at: r.sent_at.toISOString() }))
}

export type InboxMessage = StoredMessage & { channel: string; connectionId: string; chatName: string | null; chatKind: "direct" | "group" }
export type InboxChat = ChatRow & { channel: string; connectionId: string }

export type InboxFilter = { channel?: string | undefined; connectionId?: string | undefined; chatId?: string | undefined }

/**
 * The account's inbox: messages from every synced chat on every connected connection, newest first. Narrow it by
 * channel, connection, or one chat. Only synced chats ever have stored messages, so nothing else can appear here.
 */
export async function inbox(sql: Sql, accountId: string, opts: InboxFilter & { limit: number; before?: string | undefined }): Promise<InboxMessage[]> {
  const rows = await sql<{ id: string; chat_id: string; sender: string; from_me: boolean; body: string; sent_at: Date; channel: string; connection_id: string; name: string | null; kind: "direct" | "group" }>(
    `select m.id, m.chat_id, m.sender, m.from_me, m.body, m.sent_at, k.channel, k.id as connection_id, c.name, c.kind
       from parley.message m
       join parley.chat c on c.connection_id = m.connection_id and c.id = m.chat_id and c.synced
       join parley.connection k on k.id = m.connection_id
      where k.account_id = $1 and k.status = 'connected'
        and ($2::text is null or k.channel = $2)
        and ($3::uuid is null or k.id = $3)
        and ($4::text is null or m.chat_id = $4)
        and ($5::timestamptz is null or m.sent_at < $5)
      order by m.sent_at desc, m.seq desc limit $6`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, opts.chatId ?? null, opts.before ?? null, opts.limit]
  )
  return rows.map((r) => ({
    id: r.id, chatId: r.chat_id, sender: r.sender, fromMe: r.from_me, text: r.body, at: r.sent_at.toISOString(),
    channel: r.channel, connectionId: r.connection_id, chatName: r.name, chatKind: r.kind,
  }))
}

/** Synced chats across the account's connected connections, most recent first. */
export async function inboxChats(sql: Sql, accountId: string, opts: InboxFilter): Promise<InboxChat[]> {
  const rows = await sql<Raw & { channel: string; connection_id: string }>(
    `select c.id, c.kind, c.name, c.synced, c.last_message_at, k.channel, k.id as connection_id
       from parley.chat c join parley.connection k on k.id = c.connection_id
      where k.account_id = $1 and k.status = 'connected' and c.synced
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3)
      order by c.last_message_at desc nulls last, c.name nulls last`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null]
  )
  return rows.map((r) => ({ ...chatRow(r), channel: r.channel, connectionId: r.connection_id }))
}
