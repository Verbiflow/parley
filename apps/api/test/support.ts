import { after } from "node:test"
import { Client } from "pg"
import { serve, type ServerType } from "@hono/node-server"
import { migrate, RequestDatabase, readConfig } from "@parley/auth"
import { MIGRATIONS } from "@parley/auth/migrate"
import type { Channel } from "@parley/channels"
import { makeApp } from "../src/app.ts"
import { makeContext, type AppContext } from "../src/context.ts"

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5432/postgres"

/** A fresh migrated database + a running HTTP server for one test file, both torn down at the end. */
export async function testServer(channels?: Channel[]): Promise<{ ctx: AppContext; base: string; sql: AppContext["sql"] }> {
  const name = `parley_api_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect().catch((e) => {
    throw new Error(`Tests need Postgres at ${ADMIN_URL} (set DATABASE_ADMIN_URL): ${e instanceof Error ? e.message : String(e)}`)
  })
  await admin.query(`create database "${name}"`)
  await admin.end()

  const url = Object.assign(new URL(ADMIN_URL), { pathname: `/${name}` }).toString()
  const migrator = new Client({ connectionString: url })
  await migrator.connect()
  await migrate(migrator, MIGRATIONS)
  await migrator.end()

  const config = readConfig({ PARLEY_ENV: "local", DATABASE_URL: url })
  const db = new RequestDatabase(url)
  const ctx = makeContext(config, db, channels)
  const app = makeApp(ctx)

  const server: ServerType = serve({ fetch: app.fetch, port: 0 })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.close()
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    await cleanup.query(`drop database if exists "${name}" with (force)`)
    await cleanup.end()
  })

  return { ctx, base, sql: ctx.sql }
}
