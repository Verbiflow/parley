import { RequestDatabase, type Sql, type IdentityConfig, tokenKeys, type TokenKeys } from "@parley/auth"

/** How long an MCP access token lives before the client must refresh it. */
export const ACCESS_TOKEN_SECONDS = 3600

/**
 * What the HTTP app, the OAuth server and the MCP endpoint all share: parsed config, one database handle, and the
 * token keys. The access-token keys issue the longer-lived (1h) tokens agents carry over MCP; they verify with the
 * same signing key as every other connection token.
 */
export type AppContext = {
  config: IdentityConfig
  db: RequestDatabase
  sql: Sql
  accessTokenKeys: Promise<TokenKeys>
}

export function makeContext(config: IdentityConfig, db?: RequestDatabase): AppContext {
  if (!config.databaseUrl && !db) throw new Error("DATABASE_URL is required")
  const database = db ?? new RequestDatabase(config.databaseUrl!)
  const accessTokenConfig = { signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }
  return {
    config,
    db: database,
    sql: database.query,
    accessTokenKeys: tokenKeys(accessTokenConfig, config.env),
  }
}
