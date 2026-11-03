import { RequestDatabase, type Sql, type IdentityConfig, tokenKeys, type TokenKeys } from "@parley/auth"
import { CHANNELS, type Channel } from "@parley/channels"
import { Sessions } from "./sessions/actor.ts"

/** How long an MCP access token lives before the client must refresh it. */
export const ACCESS_TOKEN_SECONDS = 3600

/**
 * What the HTTP app, the OAuth server and the MCP endpoint all share: parsed config, one database handle, the token
 * keys, and the registered channels. Everything that lists or dispatches channels reads `channels`, so adding a
 * channel to the registry surfaces it everywhere with no further edits.
 */
export type AppContext = {
  config: IdentityConfig
  db: RequestDatabase
  sql: Sql
  accessTokenKeys: Promise<TokenKeys>
  channels: Channel[]
  sessions: Sessions
}

export function makeContext(config: IdentityConfig, db?: RequestDatabase, channels: Channel[] = CHANNELS): AppContext {
  if (!config.databaseUrl && !db) throw new Error("DATABASE_URL is required")
  const database = db ?? new RequestDatabase(config.databaseUrl!)
  const accessTokenConfig = { signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }
  return {
    config,
    db: database,
    sql: database.query,
    accessTokenKeys: tokenKeys(accessTokenConfig, config.env),
    channels,
    sessions: new Sessions({ sql: database.query, channels, config }),
  }
}
