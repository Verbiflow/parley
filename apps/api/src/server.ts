import { serve } from "@hono/node-server"
import { readConfig } from "@parley/auth"
import { makeApp } from "./app.ts"
import { makeContext } from "./context.ts"
import { channels } from "./channels.ts"
import { Sessions } from "./sessions/actor.ts"
import { RedisCoordinator } from "./sessions/coordinator.ts"

/**
 * All-in-one entrypoint (local dev, or a single box): the web app and the session pool in one process. Production
 * splits these — the web app on a Cloudflare Worker (`worker.ts`), the pool on EC2 (`sessions-server.ts`).
 */
const config = readConfig()
let pool!: Sessions
const ctx = makeContext(config, undefined, channels, (sql) => {
  pool = new Sessions({ sql, channels, config, coordinator: config.redisUrl ? new RedisCoordinator(config.redisUrl) : undefined })
  return pool
})
const app = makeApp(ctx)
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, async (info) => {
  await pool.start()
  const reopened = await pool.hydrateAll().catch(() => 0)
  console.log(JSON.stringify({ msg: "parley api listening", port: info.port, env: ctx.config.env, reopened }))
})
