-- Progress of the link-time history sync (recent chats, names, calls), so the chat list can say "Syncing · 42%".
alter table parley.connection
  add column history_progress smallint check (history_progress between 0 and 100),
  add column history_started_at timestamptz,
  add column history_done_at timestamptz;

-- The ids (phone-number / group ids, never names) the person ignored on this connection. A chat that turns up later
-- under one of them, after a relink or once a private id is matched to a number, starts out ignored.
alter table parley.connection add column ignored_chats jsonb not null default '[]'::jsonb;
update parley.connection k set ignored_chats = coalesce((select jsonb_agg(c.id) from parley.chat c where c.connection_id = k.id and not c.synced), '[]'::jsonb);
