import { after } from "node:test"
import { Client } from "pg"
import { RequestDatabase, type Sql } from "../src/db/database.ts"
import { migrate } from "../src/db/migrate.ts"

/**
 * A fresh, fully-migrated Postgres database for one test file, dropped when the file finishes. Mirrors mako-cloud's
 * `test/database.ts`. Point `DATABASE_ADMIN_URL` at a Postgres that can create databases; it defaults to the local
 * trust-auth server this repo's dev setup starts.
 */
const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5432/postgres"

export type TestDb = { url: string; db: RequestDatabase; sql: Sql }

export async function testDatabase(): Promise<TestDb> {
  const name = `parley_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect().catch((error) => {
    throw new Error(`Tests need Postgres reachable at ${ADMIN_URL} (set DATABASE_ADMIN_URL): ${error instanceof Error ? error.message : String(error)}`)
  })
  await admin.query(`create database "${name}"`)
  await admin.end()

  const url = Object.assign(new URL(ADMIN_URL), { pathname: `/${name}` }).toString()
  const client = new Client({ connectionString: url })
  await client.connect()
  await migrate(client)
  await client.end()

  const db = new RequestDatabase(url)
  // One teardown hook so the order is right: close our own connection *before* dropping the database,
  // otherwise `drop ... with (force)` terminates the live connection and pg raises an async error.
  after(async () => {
    await db.close()
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    await cleanup.query(`drop database if exists "${name}" with (force)`)
    await cleanup.end()
  })
  return { url, db, sql: db.query }
}
