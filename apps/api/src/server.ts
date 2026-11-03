import { serve } from "@hono/node-server"
import { readConfig } from "@parley/auth"
import { makeApp } from "./app.ts"
import { makeContext } from "./context.ts"

/** Dev/prod entrypoint: parse config, build the app, listen. */
const ctx = makeContext(readConfig())
const app = makeApp(ctx)
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ msg: "parley api listening", port: info.port, env: ctx.config.env }))
})
