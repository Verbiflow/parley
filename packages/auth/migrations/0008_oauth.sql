-- OAuth 2.1 for agents connecting over MCP. Agents are public clients that register dynamically (RFC 7591) and use
-- the authorization-code grant with PKCE; the access token Parley issues is the same EdDSA connection token the rest
-- of the system verifies (identity/tokens.ts). Refresh tokens are opaque and kept only by their SHA-256.
create schema if not exists oauth;

-- A dynamically-registered client (an MCP client/agent). Public: no secret, PKCE required.
create table oauth.client (
  client_id text primary key,
  client_name text check (length(client_name) <= 200),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 20),
  grant_types text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null default 'none' check (token_endpoint_auth_method = 'none'),
  created_at timestamptz not null default now()
);

-- A one-time authorization code, bound to the client, the account that signed in, the redirect, and the PKCE
-- challenge. Only its SHA-256 is kept; it is spent once and short-lived. `session_id` becomes the token's device id.
create table oauth.auth_code (
  code_hash text primary key,
  client_id text not null references oauth.client (client_id) on delete cascade,
  user_id uuid not null references identity.account (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null check (length(code_challenge) = 43),
  scope text,
  session_id uuid not null,
  expires_at timestamptz not null,
  spent_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_code_expiry_idx on oauth.auth_code (expires_at);

-- A refresh token, by its SHA-256. One row per live MCP session; rotated on use and revocable.
create table oauth.refresh_token (
  token_hash text primary key,
  client_id text not null references oauth.client (client_id) on delete cascade,
  user_id uuid not null references identity.account (id) on delete cascade,
  session_id uuid not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index refresh_token_session_idx on oauth.refresh_token (session_id);
