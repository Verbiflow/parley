import type { Sql } from "@parley/auth/db"
import type { CallKind, Chat, InboundMessage, MediaInfo, Reaction } from "@parley/channels"

/** CRUD for `parley.chat` / `parley.message`: the chats on a connection, which are synced, and synced messages. */

/**
 * `canLoadHistory` (listChats only): Parley has a message to count back from (one stored, or an ignored chat's
 * bookmark), so its earlier history can be fetched from the phone.
 */
export type ChatRow = { id: string; kind: "direct" | "group"; name: string | null; synced: boolean; lastMessageAt: string | null; lastCallAt: string | null; lastCallKind: CallKind | null; canLoadHistory?: boolean }
/** A message's attachment as readers see it: what it is, without the channel's fetch handle. */
export type MediaView = Omit<MediaInfo, "ref" | "thumbnail">
/**
 * `seq`: arrival order (a reaction's moves when it changes), for marking a chat read. `isNew`: from the other side and
 * not yet read (see `parley.chat_read`); the account's own messages and reactions are never new.
 */
export type ReactionView = { from: string; fromMe: boolean; emoji: string; at: string; seq: number; isNew: boolean }
export type StoredMessage = {
  id: string; chatId: string; sender: string; fromMe: boolean; text: string; at: string
  media: MediaView | null; reactions: ReactionView[]; seq: number; isNew: boolean
}

/**
 * What "new since last read" means, in one place. `m`/`r` is the message/reaction, `cr` the chat's `parley.chat_read`
 * row (left-joined: a chat never read has none) and `k` its connection. New = from the other side, arrived after the
 * marker, and (messages) not sent before the newest one already seen, so history fetched later isn't news. Nothing from
 * before the connection was made is ever new.
 */
const NEW_MESSAGE = `(not m.from_me and m.seq > coalesce(cr.message_seq, 0) and m.sent_at >= coalesce(cr.seen_until, k.created_at))`
const NEW_REACTION = `(r.reactor <> 'me' and r.emoji <> '' and r.seq > coalesce(cr.reaction_seq, 0) and r.reacted_at >= k.created_at)`
/**
 * Per chat `c` (on connection `k`): its marker `cr`, and `nm.n` / `nr.n`, how many messages and reactions are new.
 * Both counts are index range scans from the marker (sent_at for messages, seq for reactions).
 */
const NEW_COUNTS = `left join parley.chat_read cr on cr.connection_id = c.connection_id and cr.chat_id = c.id
       cross join lateral (select count(*) n from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id and ${NEW_MESSAGE}) nm
       cross join lateral (select count(*) n from parley.reaction r where r.connection_id = c.connection_id and r.chat_id = c.id and ${NEW_REACTION}) nr`
/** Joins `cr` onto a query over messages `m` (which joins its connection as `k`). */
const READ_JOIN = `left join parley.chat_read cr on cr.connection_id = m.connection_id and cr.chat_id = m.chat_id`

type RawMessage = {
  id: string; chat_id: string; sender: string; from_me: boolean; body: string; sent_at: Date; media: MediaInfo | null; seq: string; is_new: boolean
  reactions: Array<{ from: string; from_me: boolean; emoji: string; at: string; seq: number; new: boolean }> | null
}
const MESSAGE_COLS = `m.id, m.chat_id, m.sender, m.from_me, m.body, m.sent_at, m.media, m.seq, ${NEW_MESSAGE} as is_new,
  (select jsonb_agg(jsonb_build_object('from', r.reactor, 'from_me', r.reactor = 'me', 'emoji', r.emoji, 'at', r.reacted_at, 'seq', r.seq, 'new', ${NEW_REACTION}) order by r.reacted_at)
     from parley.reaction r where r.connection_id = m.connection_id and r.chat_id = m.chat_id and r.message_id = m.id and r.emoji <> '') as reactions`
const messageView = (r: RawMessage): StoredMessage => {
  // Neither the fetch handle nor the preview goes out with every message: get_media has those.
  const { ref: _ref, thumbnail: _thumb, ...media } = r.media ?? ({} as MediaInfo)
  return {
    id: r.id, chatId: r.chat_id, sender: r.sender, fromMe: r.from_me, text: r.body, at: r.sent_at.toISOString(),
    media: r.media ? media : null,
    reactions: (r.reactions ?? []).map((x) => ({ from: x.from, fromMe: x.from_me, emoji: x.emoji, at: new Date(x.at).toISOString(), seq: Number(x.seq), isNew: x.new })),
    seq: Number(r.seq), isNew: r.is_new,
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
     insert into parley.chat (connection_id, id, kind, name, synced, last_message_at, last_call_at, last_call_kind, anchor)
     select $1, t, 'direct', name, synced, last_message_at, last_call_at, last_call_kind, anchor from src
     on conflict (connection_id, id) do update set
       name = coalesce(parley.chat.name, excluded.name),
       anchor = case when excluded.anchor is null then parley.chat.anchor
                     when parley.chat.anchor is null or (excluded.anchor->>'at')::timestamptz > (parley.chat.anchor->>'at')::timestamptz then excluded.anchor
                     else parley.chat.anchor end,
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
  // How far the chat was read moves across too (the further of the two), before the old chat takes its marker with it.
  await sql(
    `insert into parley.chat_read (connection_id, chat_id, message_seq, seen_until, reaction_seq, read_at)
     select $1, p.t, cr.message_seq, cr.seen_until, cr.reaction_seq, cr.read_at
       from jsonb_to_recordset($2::jsonb) as p(f text, t text) join parley.chat_read cr on cr.connection_id = $1 and cr.chat_id = p.f
     on conflict (connection_id, chat_id) do update set
       message_seq = greatest(parley.chat_read.message_seq, excluded.message_seq), seen_until = greatest(parley.chat_read.seen_until, excluded.seen_until),
       reaction_seq = greatest(parley.chat_read.reaction_seq, excluded.reaction_seq), read_at = greatest(parley.chat_read.read_at, excluded.read_at)`,
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
  const rows = await sql<Raw & { can_load: boolean }>(
    `select ${COLS}, (anchor is not null or exists (select 1 from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id)) as can_load
       from parley.chat c
      where connection_id = $1 ${opts.syncedOnly ? "and synced" : ""}
      order by last_message_at desc nulls last, name nulls last, id`,
    [connectionId]
  )
  return rows.map((r) => ({ ...chatRow(r), canLoadHistory: r.can_load }))
}

/** A time as ISO text in UTC, whatever the session's time zone. */
const UTC = (t: string) => `to_char(${t} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
/** A message's key and time as a chat's bookmark (`parley.chat.anchor`): never its text. */
const ANCHOR_OF = (m: string) => `jsonb_build_object('id', ${m}.id, 'from_me', ${m}.from_me, 'sender', ${m}.sender, 'at', ${UTC(`${m}.sent_at`)})`
/**
 * Bookmark the newest stored message of these chats before their messages are deleted (an ignore), unless the chat
 * already holds a newer bookmark.
 */
const BOOKMARK_STORED = `update parley.chat c set anchor = n.a
   from (select distinct on (m.chat_id) m.chat_id, ${ANCHOR_OF("m")} as a, m.sent_at
           from parley.message m where m.connection_id = $1 and m.chat_id in (select jsonb_array_elements_text($2::jsonb))
          order by m.chat_id, m.sent_at desc, m.seq desc) n
  where c.connection_id = $1 and c.id = n.chat_id and (c.anchor is null or (c.anchor->>'at')::timestamptz <= n.sent_at)`

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
  const off = await sql<{ id: string }>(
    `select id from parley.chat where connection_id = $1 and synced and id not in (select jsonb_array_elements_text($2::jsonb))`,
    [connectionId, ids]
  )
  if (off.length) {
    const offIds = JSON.stringify(off.map((r) => r.id))
    await sql(BOOKMARK_STORED, [connectionId, offIds])
    await sql(
      `with off as (
         update parley.chat set synced = false, updated_at = now()
          where connection_id = $1 and synced and id in (select jsonb_array_elements_text($2::jsonb)) returning id)
       delete from parley.message m using off where m.connection_id = $1 and m.chat_id = off.id`,
      [connectionId, offIds]
    )
  }
  await sql(`update parley.connection set chats_chosen_at = now(), updated_at = now() where id = $1`, [connectionId])
  return on.map((r) => r.id)
}

/**
 * Ignore (or stop ignoring) a few chats; every other chat is left as it is. Chats sync by default, so this is the
 * person's control: an ignored chat's stored messages are deleted, and new ones are never stored or shown to agents.
 * Only a bookmark of its newest message is kept (no text), so its history can be fetched again if it's turned back on.
 */
export async function setIgnored(sql: Sql, connectionId: string, chatIds: string[], ignored: boolean): Promise<void> {
  if (!chatIds.length) return
  const ids = JSON.stringify(chatIds)
  if (ignored) await sql(BOOKMARK_STORED, [connectionId, ids])
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

/** A message key: its chat and id. */
export type MessageKey = { chatId: string; id: string }

/**
 * Store messages, but only those in synced chats (the filter is in the insert, so a race with un-syncing can't leak).
 * Reactions they arrived with are stored after them. Answers what actually changed: the messages stored for the first
 * time (not ones seen before, or skipped), and the reactions that changed.
 */
export async function saveMessages(sql: Sql, connectionId: string, messages: InboundMessage[]): Promise<{ inserted: MessageKey[]; reactions: ChangedReaction[] }> {
  if (!messages.length) return { inserted: [], reactions: [] }
  const rows = await sql<{ chat_id: string; id: string; inserted: boolean }>(
    `insert into parley.message (connection_id, chat_id, id, sender, from_me, body, sent_at, media)
     select $1, m.chat_id, m.id, left(m.sender, 200), m.from_me, m.body, m.at, m.media
       from jsonb_array_elements($2::jsonb) with ordinality as e(v, ord),
            jsonb_to_record(e.v) as m(chat_id text, id text, sender text, from_me boolean, body text, at timestamptz, media jsonb)
       join parley.chat c on c.connection_id = $1 and c.id = m.chat_id and c.synced
      order by e.ord
     on conflict (connection_id, chat_id, id) do update set media = excluded.media
      -- The same message again (a backfill): fill in an attachment stored without one, or without its preview.
      where excluded.media is not null
        and (parley.message.media is null or (excluded.media ? 'thumbnail' and not parley.message.media ? 'thumbnail'))
     returning chat_id, id, (xmax = 0) as inserted`,
    [connectionId, JSON.stringify(messages.map((m) => ({ chat_id: m.threadId, id: m.id, sender: m.from, from_me: Boolean(m.fromMe), body: m.text, at: m.at, media: m.media ?? null })))]
  )
  // An ignored chat keeps none of these, only a bookmark of the newest (its id, sender and time, never its text).
  await sql(
    `update parley.chat c set anchor = n.a
       from (select distinct on (m.chat_id) m.chat_id, jsonb_build_object('id', m.id, 'from_me', m.from_me, 'sender', left(m.sender, 200), 'at', ${UTC("m.at")}) as a, m.at
               from jsonb_to_recordset($2::jsonb) as m(chat_id text, id text, sender text, from_me boolean, at timestamptz)
              order by m.chat_id, m.at desc) n
      where c.connection_id = $1 and c.id = n.chat_id and not c.synced and (c.anchor is null or (c.anchor->>'at')::timestamptz < n.at)`,
    [connectionId, JSON.stringify(messages.map((m) => ({ chat_id: m.threadId, id: m.id, sender: m.from, from_me: Boolean(m.fromMe), at: m.at })))]
  )
  const reactions = await saveReactions(sql, connectionId, messages.flatMap((m) => m.reactions ?? []))
  return { inserted: rows.filter((r) => r.inserted).map((r) => ({ chatId: r.chat_id, id: r.id })), reactions }
}

/** A message forgotten because its sender deleted it for everyone. */
export type ForgottenMessage = MessageKey & { sender: string; fromMe: boolean; text: string; at: string }

/**
 * Forget messages their sender deleted for everyone (their reactions go with them). Ones never stored are skipped.
 * Answers the ones that were stored, and so are now gone.
 */
export async function forgetMessages(sql: Sql, connectionId: string, messages: Array<{ threadId: string; messageId: string }>): Promise<ForgottenMessage[]> {
  if (!messages.length) return []
  const rows = await sql<{ chat_id: string; id: string; sender: string; from_me: boolean; body: string; sent_at: Date }>(
    `delete from parley.message m using jsonb_to_recordset($2::jsonb) as d(chat_id text, id text)
      where m.connection_id = $1 and m.chat_id = d.chat_id and m.id = d.id
      returning m.chat_id, m.id, m.sender, m.from_me, m.body, m.sent_at`,
    [connectionId, JSON.stringify(messages.map((d) => ({ chat_id: d.threadId, id: d.messageId })))]
  )
  return rows.map((r) => ({ chatId: r.chat_id, id: r.id, sender: r.sender, fromMe: r.from_me, text: r.body, at: new Date(r.sent_at).toISOString() }))
}

/**
 * Record reactions: per person per message the latest wins, and a taken-back one is kept as an empty emoji (so an older
 * reaction arriving late doesn't revive it). Only reactions to stored messages are kept; anything else is a message
 * agents can't see.
 */
/**
 * A reaction whose emoji changed: `emoji` is the new one (empty when taken back), `before` the one it replaced (empty
 * when there was none). With the message it's on.
 */
export type ChangedReaction = {
  chatId: string; messageId: string; from: string; fromMe: boolean; emoji: string; before: string; at: string
  message: { fromMe: boolean; sender: string; text: string }
}

export async function saveReactions(sql: Sql, connectionId: string, reactions: Reaction[]): Promise<ChangedReaction[]> {
  if (!reactions.length) return []
  // `prev` reads the rows as they were before this statement's insert (one snapshot), so the answer can say what changed.
  const rows = await sql<{ chat_id: string; message_id: string; reactor: string; emoji: string; reacted_at: Date; before: string | null; m_from_me: boolean; m_sender: string; m_body: string }>(
    `with incoming as (
       select distinct on (r.chat_id, r.message_id, r.reactor) r.chat_id, r.message_id, r.reactor, r.emoji, r.at
         from jsonb_to_recordset($2::jsonb) as r(chat_id text, message_id text, reactor text, emoji text, at timestamptz)
         join parley.message m on m.connection_id = $1 and m.chat_id = r.chat_id and m.id = r.message_id
        order by r.chat_id, r.message_id, r.reactor, r.at desc
     ), prev as (
       select p.chat_id, p.message_id, p.reactor, p.emoji from parley.reaction p
         join incoming i on p.connection_id = $1 and p.chat_id = i.chat_id and p.message_id = i.message_id and p.reactor = i.reactor
     ), up as (
       insert into parley.reaction (connection_id, chat_id, message_id, reactor, emoji, reacted_at)
       select $1, chat_id, message_id, reactor, emoji, at from incoming
       on conflict (connection_id, chat_id, message_id, reactor) do update set emoji = excluded.emoji, reacted_at = excluded.reacted_at, seq = nextval('parley.reaction_seq')
        where excluded.reacted_at >= parley.reaction.reacted_at
          and (excluded.emoji, excluded.reacted_at) is distinct from (parley.reaction.emoji, parley.reaction.reacted_at)
       returning chat_id, message_id, reactor, emoji, reacted_at
     )
     select up.chat_id, up.message_id, up.reactor, up.emoji, up.reacted_at, prev.emoji as before,
            m.from_me as m_from_me, m.sender as m_sender, m.body as m_body
       from up
       left join prev on prev.chat_id = up.chat_id and prev.message_id = up.message_id and prev.reactor = up.reactor
       join parley.message m on m.connection_id = $1 and m.chat_id = up.chat_id and m.id = up.message_id`,
    [connectionId, JSON.stringify(reactions.map((r) => ({ chat_id: r.threadId, message_id: r.messageId, reactor: r.fromMe ? "me" : r.from.slice(0, 200), emoji: r.emoji.slice(0, 64), at: r.at })))]
  )
  return rows
    .filter((r) => r.emoji !== (r.before ?? ""))
    .map((r) => ({
      chatId: r.chat_id, messageId: r.message_id, from: r.reactor, fromMe: r.reactor === "me", emoji: r.emoji, before: r.before ?? "",
      at: new Date(r.reacted_at).toISOString(), message: { fromMe: r.m_from_me, sender: r.m_sender, text: r.m_body },
    }))
}

/**
 * Where fetching older history from the phone starts: the chat's newest stored message or, with none stored, its
 * bookmark (the newest message that came in while it was ignored), whichever is newer. `stored`: the anchor is a
 * stored message (so it's one of the messages a fetch returns); a bookmark's message isn't stored.
 */
export async function newestMessage(sql: Sql, connectionId: string, chatId: string): Promise<{ messageId: string; fromMe: boolean; sender: string; at: string; stored: boolean } | undefined> {
  const [r] = await sql<{ id: string; from_me: boolean; sender: string; sent_at: Date; stored: boolean }>(
    `select * from (
       (select id, from_me, sender, sent_at, true as stored from parley.message where connection_id = $1 and chat_id = $2 order by sent_at desc, seq desc limit 1)
       union all
       (select anchor->>'id', (anchor->>'from_me')::boolean, anchor->>'sender', (anchor->>'at')::timestamptz, false
          from parley.chat where connection_id = $1 and id = $2 and anchor is not null)
     ) x order by sent_at desc, stored desc limit 1`,
    [connectionId, chatId]
  )
  return r && { messageId: r.id, fromMe: r.from_me, sender: r.sender, at: new Date(r.sent_at).toISOString(), stored: r.stored }
}

/** A stored message's attachment, with the channel's fetch handle. Undefined when there's no such message or no media. */
export async function messageMedia(sql: Sql, connectionId: string, chatId: string, messageId: string): Promise<MediaInfo | undefined> {
  const [r] = await sql<{ media: MediaInfo | null }>(`select media from parley.message where connection_id = $1 and chat_id = $2 and id = $3`, [connectionId, chatId, messageId])
  return r?.media ?? undefined
}

export async function readMessages(sql: Sql, connectionId: string, chatId: string, opts: { limit: number; before?: string | undefined }): Promise<StoredMessage[]> {
  const rows = await sql<RawMessage>(
    `select ${MESSAGE_COLS} from parley.message m join parley.connection k on k.id = m.connection_id ${READ_JOIN}
      where m.connection_id = $1 and m.chat_id = $2 and ($3::timestamptz is null or m.sent_at < $3)
      order by m.sent_at desc, m.seq desc limit $4`,
    [connectionId, chatId, opts.before ?? null, opts.limit]
  )
  return rows.reverse().map(messageView)
}

export type InboxMessage = StoredMessage & { channel: string; connectionId: string; chatName: string | null; chatKind: "direct" | "group" }
/**
 * `awaiting`: who owes the next message. `you` when the last word in the chat was theirs. `newMessages`/`newReactions`:
 * how much came from the other side since the chat was last read.
 */
export type InboxChat = ChatRow & { channel: string; connectionId: string; awaiting: "you" | "them" | null; newMessages: number; newReactions: number }

export type InboxFilter = {
  channel?: string | undefined; connectionId?: string | undefined; chatId?: string | undefined; awaitingReply?: boolean | undefined
  /** Only chats with something new (inboxChats). */
  onlyNew?: boolean | undefined
}

/**
 * Narrowing the inbox to a search. `words`: every one must appear in the text, case-insensitively, anywhere and in any
 * order (a media caption or placeholder like "[document: invoice.pdf]" is the text). `after`: sent at or after.
 * `media`: only messages carrying an attachment (of that kind, or `any`). `links`: only messages with a link.
 * `fromMe`: only the account's own (true) or only the other side's (false). `onlyNew`: only ones not yet read.
 */
export type MessageSearch = {
  words?: string[] | undefined; after?: string | undefined; media?: "any" | MediaInfo["kind"] | undefined
  links?: boolean | undefined; fromMe?: boolean | undefined; onlyNew?: boolean | undefined
}
export type InboxQuery = InboxFilter & { limit: number; before?: string | undefined; search?: MessageSearch | undefined }

/** `word` as an ILIKE pattern matching it anywhere, its own `%`, `_` and `\` taken literally. */
const containing = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
/** A link in a message's text, roughly as WhatsApp's "Links" filter finds them. */
const LINK = String.raw`(https?://|www\.)[^\s]`

/**
 * The account's inbox: messages from every synced chat on every connected connection, newest first. Narrow it by
 * channel, connection, or one chat, and with `search` to what matches. Only synced chats ever have stored messages, so
 * nothing else can appear here.
 */
export async function inbox(sql: Sql, accountId: string, opts: InboxQuery): Promise<InboxMessage[]> {
  const s = opts.search ?? {}
  const words = (s.words ?? []).filter(Boolean)
  // The longest word is matched on its own as well, so the trigram index can find the candidates; the rest are checked
  // on those (an `ilike all` over an array can't use the index).
  const longest = words.reduce<string | null>((a, w) => (a === null || w.length > a.length ? w : a), null)
  const rows = await sql<RawMessage & { channel: string; connection_id: string; name: string | null; kind: "direct" | "group" }>(
    `select ${MESSAGE_COLS}, k.channel, k.id as connection_id, c.name, c.kind
       from parley.message m
       join parley.chat c on c.connection_id = m.connection_id and c.id = m.chat_id and c.synced
       join parley.connection k on k.id = m.connection_id
       ${READ_JOIN}
      where k.account_id = $1 and k.status = 'connected'
        and ($2::text is null or k.channel = $2)
        and ($3::uuid is null or k.id = $3)
        and ($4::text is null or m.chat_id = $4)
        and ($5::timestamptz is null or m.sent_at < $5)
        and ($7::text is null or m.body ilike $7)
        and (cardinality($8::text[]) = 0 or m.body ilike all($8::text[]))
        and ($9::timestamptz is null or m.sent_at >= $9)
        and ($10::text is null or ($10 = 'any' and m.media is not null) or m.media->>'kind' = $10)
        and ($11::boolean is not true or m.body ~* $12)
        and ($13::boolean is null or m.from_me = $13)
        and ($14::boolean is not true or ${NEW_MESSAGE})
      order by m.sent_at desc, m.seq desc limit $6`,
    [
      accountId, opts.channel ?? null, opts.connectionId ?? null, opts.chatId ?? null, opts.before ?? null, opts.limit,
      longest === null ? null : containing(longest), words.map(containing), s.after ?? null, s.media ?? null, s.links ?? null, LINK,
      s.fromMe ?? null, s.onlyNew ?? null,
    ]
  )
  return rows.map((r) => ({ ...messageView(r), channel: r.channel, connectionId: r.connection_id, chatName: r.name, chatKind: r.kind }))
}

export type FoundChat = { channel: string; connectionId: string; id: string; name: string | null; kind: "direct" | "group"; lastMessageAt: string | null }

/**
 * Synced chats on the account's connected connections whose name has every one of `words` in it (case-insensitively),
 * or whose id holds `digits` (a phone number, or part of one). Most recent first, at most `limit`.
 */
export async function searchChats(sql: Sql, accountId: string, opts: { channel?: string | undefined; connectionId?: string | undefined; words: string[]; digits?: string | undefined; limit: number }): Promise<FoundChat[]> {
  const words = opts.words.filter(Boolean)
  if (!words.length && !opts.digits) return []
  const rows = await sql<{ channel: string; connection_id: string; id: string; name: string | null; kind: "direct" | "group"; last_message_at: Date | null }>(
    `select k.channel, k.id as connection_id, c.id, c.name, c.kind, c.last_message_at
       from parley.chat c join parley.connection k on k.id = c.connection_id
      where k.account_id = $1 and k.status = 'connected' and c.synced
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3)
        and ((cardinality($4::text[]) > 0 and c.name ilike all($4::text[])) or ($5::text is not null and split_part(c.id, '@', 1) like $5))
      order by c.last_message_at desc nulls last, c.name nulls last
      limit $6`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, words.map(containing), opts.digits ? `%${opts.digits}%` : null, opts.limit]
  )
  return rows.map((r) => ({ channel: r.channel, connectionId: r.connection_id, id: r.id, name: r.name, kind: r.kind, lastMessageAt: r.last_message_at?.toISOString() ?? null }))
}

/** Synced chats across the account's connected connections, most recent first. `awaitingReply` keeps those whose last message was theirs. */
export async function inboxChats(sql: Sql, accountId: string, opts: InboxFilter): Promise<InboxChat[]> {
  const rows = await sql<Raw & { channel: string; connection_id: string; last_from_me: boolean | null; new_messages: string; new_reactions: string }>(
    `select c.id, c.kind, c.name, c.synced, c.last_message_at, c.last_call_at, c.last_call_kind, k.channel, k.id as connection_id, lm.from_me as last_from_me,
            nm.n as new_messages, nr.n as new_reactions
       from parley.chat c join parley.connection k on k.id = c.connection_id
       left join lateral (select m.from_me from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id order by m.sent_at desc, m.seq desc limit 1) lm on true
       ${NEW_COUNTS}
      where k.account_id = $1 and k.status = 'connected' and c.synced
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3)
        and ($4::boolean is not true or lm.from_me = false)
        and ($5::text is null or c.id = $5)
        and ($6::boolean is not true or nm.n + nr.n > 0)
      order by c.last_message_at desc nulls last, c.name nulls last`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, opts.awaitingReply ?? null, opts.chatId ?? null, opts.onlyNew ?? null]
  )
  return rows.map((r) => ({
    ...chatRow(r), channel: r.channel, connectionId: r.connection_id, awaiting: r.last_from_me === null ? null : r.last_from_me ? "them" : "you",
    newMessages: Number(r.new_messages), newReactions: Number(r.new_reactions),
  }))
}

export type NewInChat = { connectionId: string; channel: string; chatId: string; name: string | null; kind: "direct" | "group"; messages: number; reactions: number }

/**
 * The account's synced chats (on connected connections) with something new, most recent first, with how many messages
 * and reactions each. `chatId` is listed even with nothing new (so a caller can name the chat it's on). Cheap enough to
 * answer on every tool call; never marks anything read.
 */
export async function newByChat(sql: Sql, accountId: string, opts: { channel?: string | undefined; connectionId?: string | undefined; chatId?: string | undefined } = {}): Promise<NewInChat[]> {
  const rows = await sql<{ connection_id: string; channel: string; id: string; name: string | null; kind: "direct" | "group"; messages: string; reactions: string }>(
    `select k.id as connection_id, k.channel, c.id, c.name, c.kind, nm.n as messages, nr.n as reactions
       from parley.chat c join parley.connection k on k.id = c.connection_id
       ${NEW_COUNTS}
      where k.account_id = $1 and k.status = 'connected' and c.synced
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3)
        and (nm.n + nr.n > 0 or c.id = $4)
      order by c.last_message_at desc nulls last, c.name nulls last`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, opts.chatId ?? null]
  )
  return rows.map((r) => ({ connectionId: r.connection_id, channel: r.channel, chatId: r.id, name: r.name, kind: r.kind, messages: Number(r.messages), reactions: Number(r.reactions) }))
}

/** A reaction from the other side that came in since its chat was last read, with the message it's on. */
export type NewReaction = {
  channel: string; connectionId: string; chatId: string; chatName: string | null; messageId: string; messageText: string; onMyMessage: boolean
  from: string; emoji: string; at: string; seq: number
}

/** New reactions across the account (narrowed like the inbox), oldest arrival first, at most `limit`. */
export async function newReactions(sql: Sql, accountId: string, opts: InboxFilter & { limit: number }): Promise<NewReaction[]> {
  const rows = await sql<{ channel: string; connection_id: string; chat_id: string; name: string | null; message_id: string; body: string; from_me: boolean; reactor: string; emoji: string; reacted_at: Date; seq: string }>(
    `select k.channel, k.id as connection_id, r.chat_id, c.name, r.message_id, left(m.body, 200) as body, m.from_me, r.reactor, r.emoji, r.reacted_at, r.seq
       from parley.reaction r
       join parley.message m on m.connection_id = r.connection_id and m.chat_id = r.chat_id and m.id = r.message_id
       join parley.chat c on c.connection_id = r.connection_id and c.id = r.chat_id and c.synced
       join parley.connection k on k.id = r.connection_id
       left join parley.chat_read cr on cr.connection_id = r.connection_id and cr.chat_id = r.chat_id
      where k.account_id = $1 and k.status = 'connected'
        and ($2::text is null or k.channel = $2) and ($3::uuid is null or k.id = $3) and ($4::text is null or r.chat_id = $4)
        and ${NEW_REACTION}
      order by r.seq limit $5`,
    [accountId, opts.channel ?? null, opts.connectionId ?? null, opts.chatId ?? null, opts.limit]
  )
  return rows.map((r) => ({
    channel: r.channel, connectionId: r.connection_id, chatId: r.chat_id, chatName: r.name, messageId: r.message_id, messageText: r.body, onMyMessage: r.from_me,
    from: r.reactor, emoji: r.emoji, at: r.reacted_at.toISOString(), seq: Number(r.seq),
  }))
}

/**
 * Mark chats read up to what was shown: the latest message (`messageSeq`, and `seenUntil`, the newest send time among
 * them) and reaction (`reactionSeq`). Markers only move forward. Only chats on the account's own connections are marked.
 */
export async function markRead(sql: Sql, accountId: string, marks: Array<{ connectionId: string; chatId: string; messageSeq?: number; seenUntil?: string; reactionSeq?: number }>): Promise<void> {
  if (!marks.length) return
  await sql(
    `insert into parley.chat_read (connection_id, chat_id, message_seq, seen_until, reaction_seq)
     select x.connection_id, x.chat_id, coalesce(max(x.message_seq), 0), greatest(k.created_at, coalesce(max(x.seen_until), k.created_at)), coalesce(max(x.reaction_seq), 0)
       from jsonb_to_recordset($2::jsonb) as x(connection_id uuid, chat_id text, message_seq bigint, seen_until timestamptz, reaction_seq bigint)
       join parley.connection k on k.id = x.connection_id and k.account_id = $1
       join parley.chat c on c.connection_id = x.connection_id and c.id = x.chat_id
      group by x.connection_id, x.chat_id, k.created_at
     on conflict (connection_id, chat_id) do update set
       message_seq = greatest(parley.chat_read.message_seq, excluded.message_seq),
       seen_until = greatest(parley.chat_read.seen_until, excluded.seen_until),
       reaction_seq = greatest(parley.chat_read.reaction_seq, excluded.reaction_seq),
       read_at = now()`,
    [accountId, JSON.stringify(marks.map((m) => ({ connection_id: m.connectionId, chat_id: m.chatId, message_seq: m.messageSeq ?? null, seen_until: m.seenUntil ?? null, reaction_seq: m.reactionSeq ?? null })))]
  )
}
