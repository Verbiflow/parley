import type { Sql } from "@parley/auth/db"
import type { CallKind, Chat, InboundMessage, MediaInfo, Reaction } from "@parley/channels"

/** CRUD for `parley.chat` / `parley.message`: the chats on a connection, which are synced, and synced messages. */

export type ChatRow = { id: string; kind: "direct" | "group"; name: string | null; synced: boolean; lastMessageAt: string | null; lastCallAt: string | null; lastCallKind: CallKind | null }
/** A message's attachment as readers see it: what it is, without the channel's fetch handle. */
export type MediaView = Omit<MediaInfo, "ref" | "thumbnail">
export type ReactionView = { from: string; fromMe: boolean; emoji: string; at: string }
export type StoredMessage = {
  id: string; chatId: string; sender: string; fromMe: boolean; text: string; at: string
  media: MediaView | null; reactions: ReactionView[]
}

type RawMessage = { id: string; chat_id: string; sender: string; from_me: boolean; body: string; sent_at: Date; media: MediaInfo | null; reactions: Array<{ from: string; from_me: boolean; emoji: string; at: string }> | null }
const MESSAGE_COLS = `m.id, m.chat_id, m.sender, m.from_me, m.body, m.sent_at, m.media,
  (select jsonb_agg(jsonb_build_object('from', r.reactor, 'from_me', r.reactor = 'me', 'emoji', r.emoji, 'at', r.reacted_at) order by r.reacted_at)
     from parley.reaction r where r.connection_id = m.connection_id and r.chat_id = m.chat_id and r.message_id = m.id and r.emoji <> '') as reactions`
const messageView = (r: RawMessage): StoredMessage => {
  // Neither the fetch handle nor the preview goes out with every message: get_media has those.
  const { ref: _ref, thumbnail: _thumb, ...media } = r.media ?? ({} as MediaInfo)
  return {
    id: r.id, chatId: r.chat_id, sender: r.sender, fromMe: r.from_me, text: r.body, at: r.sent_at.toISOString(),
    media: r.media ? media : null,
    reactions: (r.reactions ?? []).map((x) => ({ from: x.from, fromMe: x.from_me, emoji: x.emoji, at: new Date(x.at).toISOString() })),
  }
}

type Raw = { id: string; kind: "direct" | "group"; name: string | null; synced: boolean; last_message_at: Date | null; last_call_at: Date | null; last_call_kind: CallKind | null }
const chatRow = (r: Raw): ChatRow => ({
  id: r.id, kind: r.kind, name: r.name, synced: r.synced, lastMessageAt: r.last_message_at?.toISOString() ?? null,
  lastCallAt: r.last_call_at?.toISOString() ?? null, lastCallKind: r.last_call_kind ?? null,
})
const COLS = "id, kind, name, synced, last_message_at, last_call_at, last_call_kind"

/**
 * Upsert chats the channel reported. A known name is never blanked, and last activity only moves forward. A call is
 * activity too (it moves the chat up), and the latest call's time and direction are kept for the list.
 */
export async function upsertChats(sql: Sql, connectionId: string, chats: Chat[]): Promise<void> {
  if (!chats.length) return
  await sql(
    `insert into parley.chat (connection_id, id, kind, name, synced, last_message_at, last_call_at, last_call_kind)
     select $1, c.id, c.kind, nullif(left(c.name, 200), ''), not jsonb_exists((select ignored_chats from parley.connection where id = $1), c.id), greatest(c.at, c.call_at), c.call_at, c.call_kind
       from jsonb_to_recordset($2::jsonb) as c(id text, kind text, name text, at timestamptz, call_at timestamptz, call_kind text)
     on conflict (connection_id, id) do update set
       kind = excluded.kind,
       name = coalesce(excluded.name, parley.chat.name),
       last_message_at = greatest(parley.chat.last_message_at, excluded.last_message_at),
       last_call_kind = case when excluded.last_call_at >= parley.chat.last_call_at or parley.chat.last_call_at is null
                             then coalesce(excluded.last_call_kind, parley.chat.last_call_kind) else parley.chat.last_call_kind end,
       last_call_at = greatest(parley.chat.last_call_at, excluded.last_call_at),
       updated_at = now()`,
    [connectionId, JSON.stringify(chats.map((c) => ({ id: c.id, kind: c.kind, name: c.name, at: c.lastMessageAt ?? null, call_at: c.lastCall?.at ?? null, call_kind: c.lastCall?.kind ?? null })))]
  )
}

/** Name one-to-one chats already on the connection (an address book is far bigger than the chat list: no inserts). */
export async function nameChats(sql: Sql, connectionId: string, names: Array<{ id: string; name: string }>): Promise<void> {
  if (!names.length) return
  await sql(
    `update parley.chat c set name = left(n.name, 200), updated_at = now()
       from jsonb_to_recordset($2::jsonb) as n(id text, name text)
      where c.connection_id = $1 and c.id = n.id and c.kind = 'direct' and nullif(n.name, '') is not null and c.name is distinct from left(n.name, 200)`,
    [connectionId, JSON.stringify(names)]
  )
}

/**
 * Fold chats that turned out to be the same person (`f`, e.g. a private id, into `t`, their phone number): the kept row
 * gets the better name, the latest activity and call, and stays ignored if either was; messages move across; `f` goes.
 */
export async function mergeChats(sql: Sql, connectionId: string, pairs: Array<{ from: string; to: string }>): Promise<void> {
  const list = pairs.filter((p) => p.from && p.to && p.from !== p.to)
  if (!list.length) return
  const json = JSON.stringify(list.map((p) => ({ f: p.from, t: p.to })))
  const moved = await sql<{ f: string; t: string }>(
    `with p as (select distinct on (t) f, t from jsonb_to_recordset($2::jsonb) as p(f text, t text) order by t, f),
          src as (select c.*, p.t from parley.chat c join p on c.connection_id = $1 and c.id = p.f and c.kind = 'direct')
     insert into parley.chat (connection_id, id, kind, name, synced, last_message_at, last_call_at, last_call_kind)
     select $1, t, 'direct', name, synced, last_message_at, last_call_at, last_call_kind from src
     on conflict (connection_id, id) do update set
       name = coalesce(parley.chat.name, excluded.name),
       synced = parley.chat.synced and excluded.synced,
       last_message_at = greatest(parley.chat.last_message_at, excluded.last_message_at),
       last_call_kind = case when parley.chat.last_call_at is null or excluded.last_call_at > parley.chat.last_call_at
                             then coalesce(excluded.last_call_kind, parley.chat.last_call_kind) else parley.chat.last_call_kind end,
       last_call_at = greatest(parley.chat.last_call_at, excluded.last_call_at),
       updated_at = now()
     returning id as t, (select f from p where p.t = parley.chat.id) as f`,
    [connectionId, json]
  )
  if (!moved.length) return
  const done = JSON.stringify(moved)
  // The same message can be stored under both ids: keep one, then move the rest across and drop the old rows.
  await sql(
    `with p as (select f, t from jsonb_to_recordset($2::jsonb) as p(f text, t text))
     delete from parley.message m using p
      where m.connection_id = $1 and m.chat_id = p.f
        and exists (select 1 from parley.message x where x.connection_id = $1 and x.chat_id = p.t and x.id = m.id)`,
    [connectionId, done]
  )
  await sql(
    `with p as (select f, t from jsonb_to_recordset($2::jsonb) as p(f text, t text))
     update parley.message m set chat_id = p.t from p where m.connection_id = $1 and m.chat_id = p.f`,
    [connectionId, done]
  )
  await sql(`delete from parley.chat where connection_id = $1 and id in (select f from jsonb_to_recordset($2::jsonb) as p(f text, t text))`, [connectionId, done])
  // An ignore made under either id now holds for the person under their number.
  await sql(
    `update parley.connection k set ignored_chats = coalesce((
       select jsonb_agg(distinct x) from (
         select jsonb_array_elements_text(k.ignored_chats) x
         union select c.id from parley.chat c where c.connection_id = $1 and not c.synced and c.id in (select t from jsonb_to_recordset($2::jsonb) as p(f text, t text))) s), '[]'::jsonb)
     where k.id = $1`,
    [connectionId, done]
  )
  // A merged chat that's ignored keeps nothing.
  await sql(
    `delete from parley.message m using parley.chat c
      where m.connection_id = $1 and c.connection_id = $1 and c.id = m.chat_id and not c.synced
        and c.id in (select t from jsonb_to_recordset($2::jsonb) as p(f text, t text))`,
    [connectionId, done]
  )
}

/**
 * Record activity in a chat a message just arrived in. Channels normally report the chat first (with its kind and
 * name); if one didn't, it's listed as a direct chat until a `chats` event corrects it.
 */
export async function touchChats(sql: Sql, connectionId: string, activity: Array<{ id: string; at: string }>): Promise<void> {
  if (!activity.length) return
  await sql(
    `insert into parley.chat (connection_id, id, kind, synced, last_message_at)
     select $1, a.id, 'direct', not jsonb_exists((select ignored_chats from parley.connection where id = $1), a.id), max(a.at)
       from jsonb_to_recordset($2::jsonb) as a(id text, at timestamptz) group by a.id
     on conflict (connection_id, id) do update set last_message_at = greatest(parley.chat.last_message_at, excluded.last_message_at), updated_at = now()`,
    [connectionId, JSON.stringify(activity)]
  )
}

/** One chat's activity (see `touchChats`). */
export async function touchChat(sql: Sql, connectionId: string, chatId: string, at: string): Promise<void> {
  await touchChats(sql, connectionId, [{ id: chatId, at }])
}

export async function listChats(sql: Sql, connectionId: string, opts: { syncedOnly?: boolean } = {}): Promise<ChatRow[]> {
  const rows = await sql<Raw>(
    `select ${COLS} from parley.chat
      where connection_id = $1 ${opts.syncedOnly ? "and synced" : ""}
      order by last_message_at desc nulls last, name nulls last, id`,
    [connectionId]
  )
  return rows.map(chatRow)
}

export async function getChat(sql: Sql, connectionId: string, chatId: string): Promise<ChatRow | undefined> {
  const [r] = await sql<Raw>(`select ${COLS} from parley.chat where connection_id = $1 and id = $2`, [connectionId, chatId])
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

/**
 * Ignore (or stop ignoring) a few chats; every other chat is left as it is. Chats sync by default, so this is the
 * person's control: an ignored chat's stored messages are deleted, and new ones are never stored or shown to agents.
 */
export async function setIgnored(sql: Sql, connectionId: string, chatIds: string[], ignored: boolean): Promise<void> {
  if (!chatIds.length) return
  const ids = JSON.stringify(chatIds)
  await sql(
    `update parley.chat set synced = $3, updated_at = now()
      where connection_id = $1 and synced is distinct from $3 and id in (select jsonb_array_elements_text($2::jsonb))`,
    [connectionId, ids, !ignored]
  )
  if (ignored) await sql(`delete from parley.message where connection_id = $1 and chat_id in (select jsonb_array_elements_text($2::jsonb))`, [connectionId, ids])
  await sql(
    `update parley.connection set ignored_chats = coalesce((
       select jsonb_agg(distinct x) from (
         select x from jsonb_array_elements_text(ignored_chats) x where $3 or x not in (select jsonb_array_elements_text($2::jsonb))
         union select jsonb_array_elements_text($2::jsonb) where $3) s), '[]'::jsonb)
     where id = $1`,
    [connectionId, ids, ignored]
  )
  await sql(`update parley.connection set chats_chosen_at = coalesce(chats_chosen_at, now()), updated_at = now() where id = $1`, [connectionId])
}

export async function chatsChosen(sql: Sql, connectionId: string): Promise<boolean> {
  const [r] = await sql<{ chosen: boolean }>(`select chats_chosen_at is not null as chosen from parley.connection where id = $1`, [connectionId])
  return Boolean(r?.chosen)
}

/**
 * Store messages, but only those in synced chats (the filter is in the insert, so a race with un-syncing can't leak).
 * Reactions they arrived with are stored after them.
 */
export async function saveMessages(sql: Sql, connectionId: string, messages: InboundMessage[]): Promise<void> {
  if (!messages.length) return
  await sql(
    `insert into parley.message (connection_id, chat_id, id, sender, from_me, body, sent_at, media)
     select $1, m.chat_id, m.id, left(m.sender, 200), m.from_me, m.body, m.at, m.media
       from jsonb_array_elements($2::jsonb) with ordinality as e(v, ord),
            jsonb_to_record(e.v) as m(chat_id text, id text, sender text, from_me boolean, body text, at timestamptz, media jsonb)
       join parley.chat c on c.connection_id = $1 and c.id = m.chat_id and c.synced
      order by e.ord
     on conflict (connection_id, chat_id, id) do update set media = excluded.media
      -- The same message again (a backfill): fill in an attachment stored without one, or without its preview.
      where excluded.media is not null
        and (parley.message.media is null or (excluded.media ? 'thumbnail' and not parley.message.media ? 'thumbnail'))`,
    [connectionId, JSON.stringify(messages.map((m) => ({ chat_id: m.threadId, id: m.id, sender: m.from, from_me: Boolean(m.fromMe), body: m.text, at: m.at, media: m.media ?? null })))]
  )
  await saveReactions(sql, connectionId, messages.flatMap((m) => m.reactions ?? []))
}

/** Forget messages their sender deleted for everyone (their reactions go with them). Ones never stored are skipped. */
export async function forgetMessages(sql: Sql, connectionId: string, messages: Array<{ threadId: string; messageId: string }>): Promise<void> {
  if (!messages.length) return
  await sql(
    `delete from parley.message m using jsonb_to_recordset($2::jsonb) as d(chat_id text, id text)
      where m.connection_id = $1 and m.chat_id = d.chat_id and m.id = d.id`,
    [connectionId, JSON.stringify(messages.map((d) => ({ chat_id: d.threadId, id: d.messageId })))]
  )
}

/**
 * Record reactions: per person per message the latest wins, and a taken-back one is kept as an empty emoji (so an older
 * reaction arriving late doesn't revive it). Only reactions to stored messages are kept; anything else is a message
 * agents can't see.
 */
export async function saveReactions(sql: Sql, connectionId: string, reactions: Reaction[]): Promise<void> {
  if (!reactions.length) return
  await sql(
    `insert into parley.reaction (connection_id, chat_id, message_id, reactor, emoji, reacted_at)
     select distinct on (r.chat_id, r.message_id, r.reactor) $1, r.chat_id, r.message_id, r.reactor, r.emoji, r.at
       from jsonb_to_recordset($2::jsonb) as r(chat_id text, message_id text, reactor text, emoji text, at timestamptz)
       join parley.message m on m.connection_id = $1 and m.chat_id = r.chat_id and m.id = r.message_id
      order by r.chat_id, r.message_id, r.reactor, r.at desc
     on conflict (connection_id, chat_id, message_id, reactor) do update set emoji = excluded.emoji, reacted_at = excluded.reacted_at
      where excluded.reacted_at >= parley.reaction.reacted_at`,
    [connectionId, JSON.stringify(reactions.map((r) => ({ chat_id: r.threadId, message_id: r.messageId, reactor: r.fromMe ? "me" : r.from.slice(0, 200), emoji: r.emoji.slice(0, 64), at: r.at })))]
  )
}

/** A chat's newest stored message: where fetching older history from the phone starts. */
export async function newestMessage(sql: Sql, connectionId: string, chatId: string): Promise<{ messageId: string; fromMe: boolean; sender: string; at: string } | undefined> {
  const [r] = await sql<{ id: string; from_me: boolean; sender: string; sent_at: Date }>(
    `select id, from_me, sender, sent_at from parley.message where connection_id = $1 and chat_id = $2 order by sent_at desc, seq desc limit 1`,
    [connectionId, chatId]
  )
  return r && { messageId: r.id, fromMe: r.from_me, sender: r.sender, at: r.sent_at.toISOString() }
}

/** A stored message's attachment, with the channel's fetch handle. Undefined when there's no such message or no media. */
export async function messageMedia(sql: Sql, connectionId: string, chatId: string, messageId: string): Promise<MediaInfo | undefined> {
  const [r] = await sql<{ media: MediaInfo | null }>(`select media from parley.message where connection_id = $1 and chat_id = $2 and id = $3`, [connectionId, chatId, messageId])
  return r?.media ?? undefined
}

export async function readMessages(sql: Sql, connectionId: string, chatId: string, opts: { limit: number; before?: string | undefined }): Promise<StoredMessage[]> {
  const rows = await sql<RawMessage>(
    `select ${MESSAGE_COLS} from parley.message m
      where m.connection_id = $1 and m.chat_id = $2 and ($3::timestamptz is null or m.sent_at < $3)
      order by m.sent_at desc, m.seq desc limit $4`,
    [connectionId, chatId, opts.before ?? null, opts.limit]
  )
  return rows.reverse().map(messageView)
}

export type InboxMessage = StoredMessage & { channel: string; connectionId: string; chatName: string | null; chatKind: "direct" | "group" }
/** `awaiting`: who owes the next message. `you` when the last word in the chat was theirs. */
export type InboxChat = ChatRow & { channel: string; connectionId: string; awaiting: "you" | "them" | null }

export type InboxFilter = { channel?: string | undefined; connectionId?: string | undefined; chatId?: string | undefined; awaitingReply?: boolean | undefined }

/**
 * The account's inbox: messages from every synced chat on every connected connection, newest first. Narrow it by
 * channel, connection, or one chat. Only synced chats ever have stored messages, so nothing else can appear here.
 */
export async function inbox(sql: Sql, accountId: string, opts: InboxFilter & { limit: number; before?: string | undefined }): Promise<InboxMessage[]> {
  const rows = await sql<RawMessage & { channel: string; connection_id: string; name: string | null; kind: "direct" | "group" }>(
    `select ${MESSAGE_COLS}, k.channel, k.id as connection_id, c.name, c.kind
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
  return rows.map((r) => ({ ...messageView(r), channel: r.channel, connectionId: r.connection_id, chatName: r.name, chatKind: r.kind }))
}

/** Synced chats across the account's connected connections, most recent first. `awaitingReply` keeps those whose last message was theirs. */
export async function inboxChats(sql: Sql, accountId: string, opts: InboxFilter): Promise<InboxChat[]> {
  const rows = await sql<Raw & { channel: string; connection_id: string; last_from_me: boolean | null }>(
    `select c.id, c.kind, c.name, c.synced, c.last_message_at, c.last_call_at, c.last_call_kind, k.channel, k.id as connection_id, lm.from_me as last_from_me
       from parley.chat c join parley.connection k on k.id = c.connection_id
       left join lateral (select m.from_me from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id order by m.sent_at desc, m.seq desc limit 1) lm on true
      where k.account_id = $1 and k.status = 'connected' and c.synced
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3)
        and ($4::boolean is not true or lm.from_me = false)
      order by c.last_message_at desc nulls last, c.name nulls last`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, opts.awaitingReply ?? null]
  )
  return rows.map((r) => ({ ...chatRow(r), channel: r.channel, connectionId: r.connection_id, awaiting: r.last_from_me === null ? null : r.last_from_me ? "them" : "you" }))
}
