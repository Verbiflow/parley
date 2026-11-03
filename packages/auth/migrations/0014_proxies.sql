-- Egress. Every connection's socket leaves through one exit in the account's own country and keeps it while it stays
-- healthy: a stable residential or mobile IP is what a real person looks like.

-- Where exits come from. A gateway (most residential/mobile providers) mints a sticky session per connection from one
-- login; a static provider is a list of fixed endpoints. `account_id` null is the hosted pool. Credentials are sealed
-- (server.v1, bound to this row) like every other secret.
create table parley.proxy_provider (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references identity.account (id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  type text not null check (type in ('gateway', 'static')),
  kind text not null check (kind in ('mobile', 'isp', 'residential', 'datacenter')),
  preset text check (length(preset) <= 40),
  gateway jsonb,
  -- ISO 3166-1 alpha-2 codes the provider can exit from; empty means any.
  countries text[] not null default '{}',
  -- A cap on sessions minted from a gateway, to bound spend. Null is unlimited.
  max_exits integer check (max_exits > 0),
  enabled boolean not null default true,
  sealed_version uuid,
  sealed_key_id text,
  sealed_iv text,
  sealed text,
  created_at timestamptz not null default now(),
  check ((type = 'gateway') = (gateway is not null and sealed is not null))
);
create index proxy_provider_account_idx on parley.proxy_provider (account_id);

-- One exit: a fixed endpoint (static; its URL sealed here) or one sticky session on a gateway.
create table parley.proxy_exit (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references parley.proxy_provider (id) on delete cascade,
  kind text not null check (kind in ('mobile', 'isp', 'residential', 'datacenter')),
  country text not null check (country ~ '^[A-Z]{2}$'),
  session_id text check (length(session_id) <= 64),
  sealed_version uuid,
  sealed_key_id text,
  sealed_iv text,
  sealed text,
  status text not null default 'active' check (status in ('active', 'cooling', 'burned', 'retired')),
  last_ip text check (length(last_ip) <= 64),
  last_checked_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  check ((session_id is null) <> (sealed is null))
);
create index proxy_exit_provider_idx on parley.proxy_exit (provider_id);

-- Which connection sends through which exit, kept as history. The database holds the two rules: a connection has one
-- live exit, and an exit fronts at most one live connection per channel (platforms link accounts that share an IP).
create table parley.proxy_assignment (
  id bigint generated always as identity primary key,
  exit_id uuid not null references parley.proxy_exit (id) on delete cascade,
  connection_id uuid not null references parley.connection (id) on delete cascade,
  channel text not null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (length(release_reason) <= 60)
);
create unique index proxy_assignment_live_connection_idx on parley.proxy_assignment (connection_id) where released_at is null;
create unique index proxy_assignment_live_exit_idx on parley.proxy_assignment (exit_id, channel) where released_at is null;
create index proxy_assignment_exit_idx on parley.proxy_assignment (exit_id);
