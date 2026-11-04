-- How far the account holder's agents have read each chat, so reading tools can say what's new since. One marker per
-- chat (shared by every agent on the account). A message is new when it arrived after the marker (`seq`) and wasn't
-- sent before the newest one already seen (`seen_until`): history pulled from the phone later is old news. A chat
-- never read counts from when its connection was made. Follows its chat: deleted with it.
create table parley.chat_read (
  connection_id uuid not null,
  chat_id text not null,
  message_seq bigint not null default 0,
  seen_until timestamptz not null,
  reaction_seq bigint not null default 0,
  read_at timestamptz not null default now(),
  primary key (connection_id, chat_id),
  foreign key (connection_id, chat_id) references parley.chat (connection_id, id) on delete cascade
);

-- Reactions in the order they arrived (or last changed): `reacted_at` is the sender's clock, so it can't be compared
-- with a marker. Rows already stored get numbers too.
create sequence parley.reaction_seq;
alter table parley.reaction add column seq bigint not null default nextval('parley.reaction_seq');
alter sequence parley.reaction_seq owned by parley.reaction.seq;

-- Everything stored before this counts as read, so the first look after the change isn't a flood of old "new".
insert into parley.chat_read (connection_id, chat_id, message_seq, seen_until, reaction_seq)
select c.connection_id, c.id,
       coalesce((select max(m.seq) from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id), 0),
       greatest(k.created_at, coalesce((select max(m.sent_at) from parley.message m where m.connection_id = c.connection_id and m.chat_id = c.id), k.created_at)),
       coalesce((select max(r.seq) from parley.reaction r where r.connection_id = c.connection_id and r.chat_id = c.id), 0)
  from parley.chat c join parley.connection k on k.id = c.connection_id;
