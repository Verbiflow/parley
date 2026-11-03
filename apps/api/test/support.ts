import { after } from "node:test"
import { Client } from "pg"
import { serve, type ServerType } from "@hono/node-server"
import { migrate, RequestDatabase, readConfig, type IdentityConfig, type Sql } from "@parley/auth"
import { MIGRATIONS } from "@parley/auth/migrate"
import type { Channel } from "@parley/channels"
import { makeApp } from "../src/app.ts"
import { makeContext, type AppContext } from "../src/context.ts"

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5432/postgres"
export const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"

/** Create + migrate a throwaway database. Returns its URL and a `drop` the caller runs last, after closing connections. */
async function createMigratedDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `parley_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
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
  const drop = async () => {
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    await cleanup.query(`drop database if exists "${name}" with (force)`)
    await cleanup.end()
  }
  return { url, drop }
}

/** A fresh migrated database (no HTTP server) for one test file, with a local config incl. REDIS_URL. */
export async function freshDatabase(): Promise<{ url: string; db: RequestDatabase; sql: Sql; config: IdentityConfig }> {
  const { url, drop } = await createMigratedDatabase()
  const db = new RequestDatabase(url)
  after(async () => {
    await db.close()
    await drop()
  })
  const config = readConfig({ PARLEY_ENV: "local", DATABASE_URL: url, REDIS_URL })
  return { url, db, sql: db.query, config }
}

/** A fresh migrated database + a running HTTP server (single-process, no Redis) for one test file. */
export async function testServer(channels?: Channel[], env: Record<string, string> = {}): Promise<{ ctx: AppContext; base: string; sql: AppContext["sql"] }> {
  const { url, drop } = await createMigratedDatabase()
  const config = readConfig({ PARLEY_ENV: "local", DATABASE_URL: url, ...env })
  const db = new RequestDatabase(url)
  const ctx = makeContext(config, db, channels)
  const server: ServerType = serve({ fetch: makeApp(ctx).fetch, port: 0 })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.close()
    await drop()
  })
  return { ctx, base, sql: ctx.sql }
}
