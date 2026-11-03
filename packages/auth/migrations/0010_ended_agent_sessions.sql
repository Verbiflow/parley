-- An MCP agent session the account holder disconnected from the dashboard. Its refresh tokens are revoked and its
-- still-unexpired access tokens are refused at /mcp, so "Disconnect" takes effect immediately, not when the token ends.
create table oauth.ended_session (
  session_id uuid primary key,
  user_id uuid not null references identity.account (id) on delete cascade,
  ended_at timestamptz not null default now()
);
