import { RequestDatabase, type Sql, type IdentityConfig, tokenKeys, type TokenKeys } from "@parley/auth"
import { CHANNELS, type Channel } from "@parley/channels"
import { Transactor } from "./db/transactor.ts"
import { memoryLimiter, type RateLimiter } from "./ratelimit.ts"
import { redisLimiter } from "./ratelimit-redis.ts"
import { Sessions, type SessionsApi } from "./sessions/actor.ts"
import { RedisCoordinator } from "./sessions/coordinator.ts"
import { Exits } from "./sessions/exits.ts"
import { fetchPublicMedia, type MediaFetcher } from "./sessions/fetch-media.ts"
import { Webhooks } from "./sessions/webhooks.ts"
import type { WebhookPoster } from "./sessions/webhook-delivery.ts"

import { ACCESS_TOKEN_SECONDS } from "./access.ts"

export { ACCESS_TOKEN_SECONDS }

/**
 * What the HTTP app, the OAuth server and the MCP endpoint all share: parsed config, one database handle, the token
 * keys, and the registered channels. Everything that lists or dispatches channels reads `channels`, so adding a
 * channel to the registry surfaces it everywhere with no further edits.
 *
 * `sessions` is the session pool's API: the pool itself (`Sessions`) when it runs in this process — locally, in
 * tests, on a single box — or `RemoteSessions` on the edge Worker (`worker.ts` builds that context itself, so this
 * module's Redis/Node imports never reach the edge bundle; it imports only the `AppContext` type).
 */
export type AppContext = {
  config: IdentityConfig
  db: RequestDatabase
  sql: Sql
  /** Transactions on their own connections, for work that holds row locks. */
  tx: Transactor
  accessTokenKeys: Promise<TokenKeys>
  channels: Channel[]
  sessions: SessionsApi
  exits: Exits
  webhooks: Webhooks
  limiter: RateLimiter
  close(): Promise<void>
}

/** The in-process context: the session pool lives here, so callers can start it and re-open connections. */
export type NodeAppContext = AppContext & { sessions: Sessions }

export function makeContext(config: IdentityConfig, db?: RequestDatabase, channels: Channel[] = CHANNELS, opts: { limiter?: RateLimiter; fetchMedia?: MediaFetcher; postWebhook?: WebhookPoster; webhookTimer?: boolean } = {}): NodeAppContext {
  if (!config.databaseUrl && !db) throw new Error("DATABASE_URL is required")
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for the outbox")
  const database = db ?? new RequestDatabase(config.databaseUrl)
  const accessTokenConfig = { signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }
  const tx = new Transactor(config.databaseUrl)
  const exits = new Exits(config)
  const webhooks = new Webhooks(config)
  const coordinator = config.redisUrl ? new RedisCoordinator(config.redisUrl) : undefined
  const sessions = new Sessions({ sql: database.query, channels, config, tx, exits, fetchMedia: opts.fetchMedia ?? fetchPublicMedia, webhooks, ...(opts.postWebhook ? { postWebhook: opts.postWebhook } : {}), ...(opts.webhookTimer === false ? { webhookTimer: false } : {}), ...(coordinator ? { coordinator } : {}) })
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
    webhooks,
    limiter,
    async close() {
      await sessions.stop()
      await coordinator?.close()
      await limiter.close()
    },
  }
}
