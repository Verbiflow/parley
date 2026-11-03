-- The chats on a connection, and which of them the account holder chose to sync. Agents only ever see synced chats:
-- an unsynced chat is listed here by name (so the person can pick it) but none of its messages are stored.
create table parley.chat (
  connection_id uuid not null references parley.connection (id) on delete cascade,
  -- The channel's own id for the conversation (a WhatsApp JID, ...). Opaque here.
  id text not null check (length(id) between 1 and 200),
  kind text not null check (kind in ('direct', 'group')),
  name text check (length(name) <= 200),
  synced boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connection_id, id)
);
create index chat_recent_idx on parley.chat (connection_id, last_message_at desc nulls last);

-- Messages in synced chats only. Turning a chat's sync off deletes its messages.
create table parley.message (
  connection_id uuid not null,
  chat_id text not null,
  id text not null check (length(id) between 1 and 200),
  sender text not null check (length(sender) <= 200),
  from_me boolean not null default false,
  body text not null,
  sent_at timestamptz not null,
  -- Arrival order, to break ties: WhatsApp timestamps are whole seconds.
  seq bigint generated always as identity,
  primary key (connection_id, chat_id, id),
  foreign key (connection_id, chat_id) references parley.chat (connection_id, id) on delete cascade
);
create index message_recent_idx on parley.message (connection_id, chat_id, sent_at desc, seq desc);

-- When the person last saved their chat selection. Null means they haven't chosen yet (the dashboard prompts them).
alter table parley.connection add column chats_chosen_at timestamptz;
