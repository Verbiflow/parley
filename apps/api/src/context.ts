import { RequestDatabase, type Sql, type IdentityConfig, tokenKeys, type TokenKeys } from "@parley/auth"
import { CHANNELS, type Channel } from "@parley/channels"
import { Sessions, type SessionsApi } from "./sessions/actor.ts"

/** How long an MCP access token lives before the client must refresh it. */
export const ACCESS_TOKEN_SECONDS = 3600

/**
 * What the HTTP app, the OAuth server and the MCP endpoint all share: parsed config, one database handle, the token
 * keys, and the registered channels. Everything that lists or dispatches channels reads `channels`, so adding a
 * channel to the registry surfaces it everywhere with no further edits.
 *
 * `sessions` is the session pool's API: in-process (`Sessions`) locally and in tests, or `RemoteSessions` on the edge
 * Worker, which forwards live operations to the EC2 sessions service. Nothing here imports Redis or Baileys, so the
 * edge bundle stays clean — the Node entrypoints wire those in.
 */
export type AppContext = {
  config: IdentityConfig
  db: RequestDatabase
  sql: Sql
  accessTokenKeys: Promise<TokenKeys>
  channels: Channel[]
  sessions: SessionsApi
}

export function makeContext(
  config: IdentityConfig,
  db?: RequestDatabase,
  channels: Channel[] = CHANNELS,
  sessions?: (sql: Sql) => SessionsApi
): AppContext {
  if (!config.databaseUrl && !db) throw new Error("DATABASE_URL is required")
  const database = db ?? new RequestDatabase(config.databaseUrl!)
  const accessTokenConfig = { signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }
  return {
    config,
    db: database,
    sql: database.query,
    accessTokenKeys: tokenKeys(accessTokenConfig, config.env),
    channels,
    sessions: sessions ? sessions(database.query) : new Sessions({ sql: database.query, channels, config }),
  }
}
