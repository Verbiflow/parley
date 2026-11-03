import { RequestDatabase, type Sql, type IdentityConfig, tokenKeys, type TokenKeys } from "@parley/auth"
import { CHANNELS, type Channel } from "@parley/channels"
import { Transactor } from "./db/transactor.ts"
import { memoryLimiter, redisLimiter, type RateLimiter } from "./ratelimit.ts"
import { Sessions } from "./sessions/actor.ts"
import { RedisCoordinator } from "./sessions/coordinator.ts"
import { Exits } from "./sessions/exits.ts"

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
  /** Transactions on their own connections, for work that holds row locks. */
  tx: Transactor
  accessTokenKeys: Promise<TokenKeys>
  channels: Channel[]
  sessions: Sessions
  exits: Exits
  limiter: RateLimiter
  close(): Promise<void>
}

export function makeContext(config: IdentityConfig, db?: RequestDatabase, channels: Channel[] = CHANNELS, opts: { limiter?: RateLimiter } = {}): AppContext {
  if (!config.databaseUrl && !db) throw new Error("DATABASE_URL is required")
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for the outbox")
  const database = db ?? new RequestDatabase(config.databaseUrl)
  const accessTokenConfig = { signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }
  const tx = new Transactor(config.databaseUrl)
  const exits = new Exits(config)
  const coordinator = config.redisUrl ? new RedisCoordinator(config.redisUrl) : undefined
  const sessions = new Sessions({ sql: database.query, channels, config, tx, exits, ...(coordinator ? { coordinator } : {}) })
  const limiter = opts.limiter ?? (config.redisUrl ? redisLimiter(config.redisUrl) : memoryLimiter())
  return {
    config,
    db: database,
    sql: database.query,
    tx,
    accessTokenKeys: tokenKeys(accessTokenConfig, config.env),
    channels,
    sessions,
    exits,
    limiter,
    async close() {
      await sessions.stop()
      await coordinator?.close()
      await limiter.close()
    },
  }
}
