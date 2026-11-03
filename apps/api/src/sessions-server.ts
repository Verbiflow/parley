import { serve } from "@hono/node-server"
import { readConfig, RequestDatabase } from "@parley/auth"
import { channels } from "./channels.ts"
import { Sessions } from "./sessions/actor.ts"
import { RedisCoordinator } from "./sessions/coordinator.ts"
import { rpcApp } from "./sessions/rpc-server.ts"

/**
 * The sessions service (production, on EC2): holds every live channel socket (Baileys for WhatsApp), writes what they
 * receive to Postgres, and serves the internal RPC the edge Worker calls. Binds to loopback only — the one way in is
 * the Cloudflare Tunnel running beside it.
 */
const config = readConfig()
const secret = process.env.SESSIONS_SECRET
if (!secret) throw new Error("SESSIONS_SECRET is required")
if (!config.databaseUrl) throw new Error("DATABASE_URL is required")

const db = new RequestDatabase(config.databaseUrl)
const sessions = new Sessions({ sql: db.query, channels, config, coordinator: config.redisUrl ? new RedisCoordinator(config.redisUrl) : undefined })
const app = rpcApp(sessions, secret)
const port = Number(process.env.PORT ?? 8790)
const hostname = process.env.HOST ?? "127.0.0.1"

serve({ fetch: app.fetch, port, hostname }, async (info) => {
  await sessions.start()
  const reopened = await sessions.hydrateAll().catch((e) => {
    console.error(JSON.stringify({ msg: "hydrate failed", error: e instanceof Error ? e.message : String(e) }))
    return 0
  })
  console.log(JSON.stringify({ msg: "parley sessions listening", host: hostname, port: info.port, env: config.env, reopened }))
})

// On a deploy/restart: stop the dispatcher (letting an in-flight send finish) and close sockets cleanly.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ msg: "parley sessions stopping", signal }))
    void sessions.stop().finally(() => process.exit(0))
  })
}

// Keep running through one bad event; systemd restarts us if the process does die.
process.on("unhandledRejection", (e) => console.error(JSON.stringify({ msg: "unhandled rejection", error: e instanceof Error ? e.message : String(e) })))
