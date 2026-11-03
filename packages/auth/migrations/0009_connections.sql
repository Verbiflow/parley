-- A connection: one account's link to one channel (its WhatsApp, its Telegram, ...). Channel-neutral — `channel` is
-- just text, and the channel's sealed session credentials live in the secret store (kind 'channel-creds', purpose the
-- channel, name the connection id). No channel-specific columns.
create schema if not exists parley;

create table parley.connection (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.account (id) on delete cascade,
  channel text not null check (length(channel) between 1 and 40),
  -- linking: waiting for the user to finish the link (scan/authorize). connected: live. logged_out: unlinked on the
  -- channel. closed: dropped locally. error: failed to open.
  status text not null default 'linking' check (status in ('linking', 'connected', 'logged_out', 'closed', 'error')),
  handle text check (length(handle) <= 200),
  display_name text check (length(display_name) <= 200),
  created_at timestamptz not null default now(),
  linked_at timestamptz,
  updated_at timestamptz not null default now()
);
create index connection_account_idx on parley.connection (account_id, created_at desc);
create index connection_live_idx on parley.connection (status) where status = 'connected';
