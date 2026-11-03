import type { Sql } from "@parley/auth/db"

/**
 * OAuth 2.1 persistence: dynamically-registered clients, one-time authorization codes, and rotating refresh tokens.
 * Codes and refresh tokens are kept only by their SHA-256. See `migrations/0008_oauth.sql`.
 */

export type Client = { clientId: string; clientName: string | null; redirectUris: string[] }

export async function registerClient(sql: Sql, client: { clientId: string; clientName?: string | null; redirectUris: string[] }): Promise<Client> {
  const [row] = await sql<{ client_id: string; client_name: string | null; redirect_uris: string[] }>(
    `insert into oauth.client (client_id, client_name, redirect_uris) values ($1, $2, $3)
     returning client_id, client_name, redirect_uris`,
    [client.clientId, client.clientName ?? null, client.redirectUris]
  )
  return { clientId: row!.client_id, clientName: row!.client_name, redirectUris: row!.redirect_uris }
}

export async function getClient(sql: Sql, clientId: string): Promise<Client | undefined> {
  const [row] = await sql<{ client_id: string; client_name: string | null; redirect_uris: string[] }>(
    `select client_id, client_name, redirect_uris from oauth.client where client_id = $1`,
    [clientId]
  )
  return row && { clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris }
}

export async function createAuthCode(
  sql: Sql,
  code: { codeHash: string; clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string | null; sessionId: string; expiresAt: Date }
): Promise<void> {
  await sql(
    `insert into oauth.auth_code (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, session_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [code.codeHash, code.clientId, code.userId, code.redirectUri, code.codeChallenge, code.scope, code.sessionId, code.expiresAt]
  )
}

export type ClaimedCode = { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string | null; sessionId: string }

/** Atomically spend a valid authorization code; undefined if unknown, expired, or already spent. */
export async function claimAuthCode(sql: Sql, codeHash: string): Promise<ClaimedCode | undefined> {
  const [row] = await sql<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string | null; session_id: string }>(
    `update oauth.auth_code set spent_at = now()
     where code_hash = $1 and spent_at is null and expires_at > now()
     returning client_id, user_id, redirect_uri, code_challenge, scope, session_id`,
    [codeHash]
  )
  return row && { clientId: row.client_id, userId: row.user_id, redirectUri: row.redirect_uri, codeChallenge: row.code_challenge, scope: row.scope, sessionId: row.session_id }
}

export async function createRefreshToken(
  sql: Sql,
  token: { tokenHash: string; clientId: string; userId: string; sessionId: string; scope: string | null; expiresAt: Date }
): Promise<void> {
  await sql(
    `insert into oauth.refresh_token (token_hash, client_id, user_id, session_id, scope, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [token.tokenHash, token.clientId, token.userId, token.sessionId, token.scope, token.expiresAt]
  )
}

export type Refreshed = { clientId: string; userId: string; sessionId: string; scope: string | null }

/** Spend (revoke) a valid refresh token and return its grant, so the caller can issue a successor; undefined if invalid. */
export async function rotateRefreshToken(sql: Sql, tokenHash: string): Promise<Refreshed | undefined> {
  const [row] = await sql<{ client_id: string; user_id: string; session_id: string; scope: string | null }>(
    `update oauth.refresh_token set revoked_at = now()
     where token_hash = $1 and revoked_at is null and expires_at > now()
       and not exists (select 1 from oauth.ended_session e where e.session_id = oauth.refresh_token.session_id)
     returning client_id, user_id, session_id, scope`,
    [tokenHash]
  )
  return row && { clientId: row.client_id, userId: row.user_id, sessionId: row.session_id, scope: row.scope }
}

export type AgentSession = {
  sessionId: string; clientName: string | null; clientId: string; connectedAt: string; lastRefreshedAt: string
  lastUsedAt: string | null; lastTool: string | null; lastToolAt: string | null; calls: number
}

/** Agents currently authorized for the account: one row per MCP session that still holds a live refresh token. */
export async function agentSessions(sql: Sql, userId: string): Promise<AgentSession[]> {
  const rows = await sql<{ session_id: string; client_id: string; client_name: string | null; connected_at: Date; last_refreshed_at: Date; last_used_at: Date | null; last_tool: string | null; last_tool_at: Date | null; calls: string | null }>(
    `select r.session_id, r.client_id, c.client_name,
            (select min(created_at) from oauth.refresh_token x where x.session_id = r.session_id) as connected_at,
            r.created_at as last_refreshed_at, a.last_used_at, a.last_tool, a.last_tool_at, a.calls::text as calls
       from oauth.refresh_token r join oauth.client c using (client_id)
       left join oauth.session_activity a on a.session_id = r.session_id
      where r.user_id = $1 and r.revoked_at is null and r.expires_at > now()
        and not exists (select 1 from oauth.ended_session e where e.session_id = r.session_id)
      order by coalesce(a.last_used_at, r.created_at) desc, r.created_at desc`,
    [userId]
  )
  const seen = new Set<string>()
  const out: AgentSession[] = []
  for (const r of rows) {
    if (seen.has(r.session_id)) continue
    seen.add(r.session_id)
    out.push({
      sessionId: r.session_id, clientId: r.client_id, clientName: r.client_name, connectedAt: r.connected_at.toISOString(), lastRefreshedAt: r.last_refreshed_at.toISOString(),
      lastUsedAt: r.last_used_at?.toISOString() ?? null, lastTool: r.last_tool, lastToolAt: r.last_tool_at?.toISOString() ?? null, calls: Number(r.calls ?? 0),
    })
  }
  return out
}

/** Disconnect an agent: mark its session ended (so live access tokens stop working) and revoke its refresh tokens. */
export async function endAgentSession(sql: Sql, userId: string, sessionId: string): Promise<void> {
  const owned = await sql(`select 1 from oauth.refresh_token where user_id = $1 and session_id = $2 limit 1`, [userId, sessionId])
  if (!owned.length) return
  await sql(`insert into oauth.ended_session (session_id, user_id) values ($1, $2) on conflict do nothing`, [sessionId, userId])
  await sql(`update oauth.refresh_token set revoked_at = now() where session_id = $1 and revoked_at is null`, [sessionId])
}

/** True when the account holder disconnected this agent session. */
export async function isSessionEnded(sql: Sql, sessionId: string): Promise<boolean> {
  const rows = await sql(`select 1 from oauth.ended_session where session_id = $1`, [sessionId])
  return rows.length > 0
}

/** Note an MCP request from an agent session (and the tool it called, if any). */
export async function recordAgentUse(sql: Sql, userId: string, sessionId: string, tool: string | null): Promise<void> {
  await sql(
    `insert into oauth.session_activity (session_id, user_id, last_used_at, last_tool, last_tool_at, calls)
     values ($1, $2, now(), $3, case when $3::text is null then null else now() end, case when $3::text is null then 0 else 1 end)
     on conflict (session_id) do update set
       last_used_at = now(),
       last_tool = coalesce(excluded.last_tool, oauth.session_activity.last_tool),
       last_tool_at = coalesce(excluded.last_tool_at, oauth.session_activity.last_tool_at),
       calls = oauth.session_activity.calls + excluded.calls`,
    [sessionId, userId, tool ? tool.slice(0, 100) : null]
  )
}
