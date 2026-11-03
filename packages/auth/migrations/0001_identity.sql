-- Parley's identity: the accounts people sign in to, the browsers signed in to the sign-in pages, the devices (agents)
-- each account has enrolled and how they got there, and what each account may use. A `user_id` column always names an
-- account. (The auth model is lifted from Verbiflow/mako-cloud; only the parts Parley needs are kept.)
create schema if not exists identity;

-- An account, as the sign-in provider vouches for it. `subject` is the provider's own ID for the person, prefixed with
-- the provider (`workos:user_…`, or `local:<email>` from the local test sign-in). The rest is refreshed at every sign-in.
create table identity.account (
  id uuid primary key default gen_random_uuid(),
  subject text not null unique check (subject ~ '^(workos|local):.+$'),
  email text not null check (length(email) between 3 and 320),
  name text not null check (length(name) between 1 and 200),
  image text check (length(image) <= 2000),
  created_at timestamptz not null default now(),
  signed_in_at timestamptz not null default now()
);
create index account_email_idx on identity.account (lower(email));

-- A browser signed in to these pages, so it can continue a sign-in or approve a device. Only the token's SHA-256 is
-- kept. `provider_session` is the upstream IdP's session for the same sign-in, ended when the person switches account.
create table identity.browser_session (
  token_hash text primary key,
  user_id uuid not null references identity.account (id) on delete cascade,
  provider_session text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index browser_session_expiry_idx on identity.browser_session (expires_at);

-- A device (an agent connecting to Parley) holds one credential until it's removed. Only its SHA-256 is kept, so a copy
-- of this table signs nothing in.
create table identity.device (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.account (id) on delete cascade,
  kind text not null check (kind in ('desktop', 'runtime', 'cli')),
  name text not null check (length(name) between 1 and 80),
  platform text not null check (length(platform) between 1 and 40),
  app_version text check (length(app_version) <= 40),
  credential_hash text not null unique,
  enrolled_by text not null check (enrolled_by in ('browser', 'device-code')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('removed', 'signed-out'))
);
create index device_user_idx on identity.device (user_id) where revoked_at is null;

-- The browser hand-off (RFC 8252 with PKCE): the page the app opened, the account that signed in, and the one-time
-- code sent back to the app's loopback address. Each row is good for minutes and spent once.
create table identity.sign_in_request (
  id uuid primary key default gen_random_uuid(),
  redirect_uri text not null,
  state text not null check (length(state) between 16 and 200),
  code_challenge text not null check (length(code_challenge) = 43),
  device_kind text not null check (device_kind in ('desktop', 'runtime', 'cli')),
  device_name text not null check (length(device_name) between 1 and 80),
  platform text not null check (length(platform) between 1 and 40),
  app_version text check (length(app_version) <= 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_id uuid references identity.account (id) on delete cascade,
  code_hash text unique,
  code_expires_at timestamptz,
  spent_at timestamptz
);
create index sign_in_request_expiry_idx on identity.sign_in_request (expires_at);

-- The device authorization grant (RFC 8628) for agents (runtimes and CLIs) with no browser of their own.
create table identity.device_code (
  device_code_hash text primary key,
  user_code text not null unique,
  device_kind text not null check (device_kind in ('desktop', 'runtime', 'cli')),
  device_name text not null check (length(device_name) between 1 and 80),
  platform text not null check (length(platform) between 1 and 40),
  app_version text check (length(app_version) <= 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'spent')),
  user_id uuid references identity.account (id) on delete cascade,
  interval_seconds integer not null default 5,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  polled_at timestamptz
);
create index device_code_expiry_idx on identity.device_code (expires_at);

-- What an account may use. `cloud` gates access until a billing system grants it; granted by hand to invited accounts.
create table identity.entitlement (
  user_id uuid not null references identity.account (id) on delete cascade,
  kind text not null check (kind in ('cloud')),
  granted_by text not null,
  note text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, kind)
);
