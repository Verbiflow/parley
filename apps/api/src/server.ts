import { serve } from "@hono/node-server"
import { readConfig } from "@parley/auth"
import { makeApp } from "./app.ts"
import { makeContext } from "./context.ts"
import { channels } from "./channels.ts"

/** Dev/prod entrypoint: parse config, build the app, start coordination, re-open live connections, listen. */
const ctx = makeContext(readConfig(), undefined, channels)
const app = makeApp(ctx)
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, async (info) => {
  await ctx.sessions.start()
  const reopened = await ctx.sessions.hydrateAll().catch(() => 0)
  console.log(JSON.stringify({ msg: "parley api listening", port: info.port, env: ctx.config.env, reopened }))
})
