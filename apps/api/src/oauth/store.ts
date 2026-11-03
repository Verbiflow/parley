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
     returning client_id, user_id, session_id, scope`,
    [tokenHash]
  )
  return row && { clientId: row.client_id, userId: row.user_id, sessionId: row.session_id, scope: row.scope }
}
