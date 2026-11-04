-- Messages a connection sent, as the platform encoded them, so one can be sent again when a device asks: a phone or
-- linked device that couldn't decrypt a message requests a resend, and with nothing to resend it shows "Waiting for this
-- message" for good. Kept in memory only, they were lost on every restart. Thirty days, then pruned.
create table parley.sent_message (
  connection_id uuid not null references parley.connection (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  message bytea not null,
  sent_at timestamptz not null default now(),
  primary key (connection_id, id)
);
create index sent_message_age_idx on parley.sent_message (connection_id, sent_at);
