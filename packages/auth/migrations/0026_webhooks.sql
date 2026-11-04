-- Webhooks: an account's URLs that hear, as it happens, about new messages, reactions and deletions on its connections.
-- Each request is signed with the webhook's own secret (HMAC-SHA256), sealed here like proxy logins (AES-256-GCM under
-- the environment's key, bound to this row), never stored in the clear.
create table parley.webhook (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.account (id) on delete cascade,
  url text not null check (length(url) between 1 and 2000),
  -- Which events it gets (see WEBHOOK_EVENTS in apps/api/src/sessions/webhooks.ts).
  events text[] not null check (cardinality(events) between 1 and 20),
  description text check (length(description) <= 200),
  enabled boolean not null default true,
  -- Who set it up: "dashboard", or the agent (its client name) that did over MCP.
  created_by text not null default 'dashboard' check (length(created_by) <= 200),
  sealed_version uuid not null,
  sealed_key_id text not null,
  sealed_iv text not null,
  sealed text not null,
  secret_hint text not null check (length(secret_hint) <= 16),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text check (length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhook_account_idx on parley.webhook (account_id, created_at);

-- One event for one webhook. At most three attempts: delivered on a 2xx, failed after the third miss. A delivery being
-- sent holds a lease; one whose lease lapsed (its worker died mid-send) is tried again, so receivers dedupe on event id.
create table parley.webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references parley.webhook (id) on delete cascade,
  event_id uuid not null,
  event text not null check (length(event) <= 60),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_status int,
  last_error text check (length(last_error) <= 500),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_delivery_due_idx on parley.webhook_delivery (next_attempt_at) where status = 'pending';
create index webhook_delivery_lease_idx on parley.webhook_delivery (lease_until) where status = 'sending';
create index webhook_delivery_hook_idx on parley.webhook_delivery (webhook_id, created_at desc);
create index webhook_delivery_age_idx on parley.webhook_delivery (created_at) where status in ('delivered', 'failed');
