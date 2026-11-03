-- When each MCP agent session last called Parley, and what it did — so the dashboard can show which agent is using
-- the account right now. One row per session, updated on every /mcp request.
create table oauth.session_activity (
  session_id uuid primary key,
  user_id uuid not null references identity.account (id) on delete cascade,
  last_used_at timestamptz not null default now(),
  last_tool text check (length(last_tool) <= 100),
  last_tool_at timestamptz,
  calls bigint not null default 0
);
