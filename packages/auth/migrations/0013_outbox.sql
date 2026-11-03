-- Human pacing. A connection sends like the person who owns it: inside their local active hours, with gaps, bursts and
-- breaks, under daily caps that warm up for new accounts. Agents queue messages; the worker holding the connection
-- sends each at the slot the planner reserved for it.

-- The connection's clock and standing. `halted_reason` set means only a person can resume it (a checkpoint, a ban).
alter table parley.connection
  add column timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column warmup jsonb not null default '{}',
  add column paused_until timestamptz,
  add column action_pauses jsonb not null default '{}',
  add column consecutive_rate_limits integer not null default 0,
  add column halted_reason text check (length(halted_reason) <= 100);

-- A message an agent asked to send. `scheduled_for` is the reserved slot; null while the connection can't send
-- (halted, not connected), keeping its place in line. `sending` carries a lease: a worker that dies mid-send leaves a
-- lapsed lease, and the message fails as outcome_unknown rather than risk sending twice.
create table parley.outbound (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references parley.connection (id) on delete cascade,
  chat_id text not null check (length(chat_id) between 1 and 200),
  kind text not null check (kind in ('message', 'first_message', 'invite')),
  body text not null check (length(body) between 1 and 8000),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'canceled')),
  scheduled_for timestamptz,
  not_before timestamptz,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  external_id text check (length(external_id) <= 200),
  error_code text check (length(error_code) <= 60),
  error_message text check (length(error_message) <= 500),
  idempotency_key text check (length(idempotency_key) between 1 and 200),
  -- The agent session that queued it, for the dashboard.
  agent_session_id uuid,
  created_at timestamptz not null default now()
);
create unique index outbound_idempotency_idx on parley.outbound (connection_id, idempotency_key) where idempotency_key is not null;
create index outbound_due_idx on parley.outbound (scheduled_for) where status = 'scheduled';
create index outbound_connection_idx on parley.outbound (connection_id, created_at desc);
create index outbound_lease_idx on parley.outbound (lease_expires_at) where status = 'sending';

-- What the platform said each time the connection tried to send. Pacing reads pushback and refused attempts from here.
create table parley.connection_event (
  id bigint generated always as identity primary key,
  connection_id uuid not null references parley.connection (id) on delete cascade,
  kind text check (kind in ('message', 'first_message', 'invite')),
  outcome text not null check (outcome in ('sent', 'rate_limited', 'limit_reached', 'challenge', 'auth_expired', 'banned', 'recipient_unavailable', 'transport_error')),
  outbound_id uuid references parley.outbound (id) on delete set null,
  detail text check (length(detail) <= 500),
  at timestamptz not null default now()
);
create index connection_event_recent_idx on parley.connection_event (connection_id, at desc);
