-- What a message's attachment is (kind, type, size, ...) plus the channel's opaque handle for fetching the file when
-- someone asks for it. Files themselves aren't stored.
alter table parley.message add column media jsonb;

-- Reactions to stored messages: one per person per message, the latest wins. A reaction that was taken back is kept
-- with an empty emoji, so a late-arriving older reaction can't bring it back. Follows its message: deleted with it
-- (an ignored chat) and moved with it (a private id folded into a phone number).
create table parley.reaction (
  connection_id uuid not null,
  chat_id text not null,
  message_id text not null,
  reactor text not null check (length(reactor) between 1 and 200),
  emoji text not null check (length(emoji) <= 64),
  reacted_at timestamptz not null,
  primary key (connection_id, chat_id, message_id, reactor),
  foreign key (connection_id, chat_id, message_id) references parley.message (connection_id, chat_id, id) on delete cascade on update cascade
);

-- Sending media and reactions. `media` says what the file is (kind, type, name); its bytes wait in `media_data` and
-- are cleared once the send settles. `react_to` makes the row a reaction to that message; `body` is then the emoji
-- (empty to take a reaction back), and a file's caption may be empty too.
alter table parley.outbound
  add column media jsonb,
  add column media_data bytea,
  add column react_to text check (length(react_to) between 1 and 200),
  drop constraint outbound_body_check,
  add constraint outbound_body_check check (length(body) <= 8000 and (length(body) >= 1 or media is not null or react_to is not null));
