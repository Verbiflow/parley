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
export async function testServer(channels?: Channel[], env: Record<string, string> = {}, opts: Parameters<typeof makeContext>[3] = {}): Promise<{ ctx: AppContext; base: string; sql: AppContext["sql"] }> {
  const { url, drop } = await createMigratedDatabase()
  const config = readConfig({ PARLEY_ENV: "local", DATABASE_URL: url, ...env })
  const db = new RequestDatabase(url)
  const ctx = makeContext(config, db, channels, opts)
  const server: ServerType = serve({ fetch: makeApp(ctx).fetch, port: 0 })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await ctx.close()
    await db.close()
    await drop()
  })
  return { ctx, base, sql: ctx.sql }
}

/** Poll `get` until `ok` holds (session events are applied asynchronously). */
export async function waitUntil<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Authorize an MCP client for `email` against a test server; returns its access token. */
export async function agentToken(base: string, email: string, name: string): Promise<string> {
  const { hashSecret, newSecret } = await import("@parley/auth")
  const redirect = "http://127.0.0.1:9999/callback"
  const reg = (await (await fetch(`${base}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }),
  })).json()) as { client_id: string }
  const verifier = newSecret("parley_dvc")
  const authorize = await fetch(`${base}/oauth/authorize`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: await hashSecret(verifier), code_challenge_method: "S256", email }),
  })
  const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!
  const tokens = (await (await fetch(`${base}/oauth/token`, {
    method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }),
  })).json()) as { access_token: string }
  return tokens.access_token
}

/** Call an MCP tool; returns the parsed JSON the tool answered with (or its error text). */
export async function callTool(base: string, token: string, name: string, args: Record<string, unknown> = {}): Promise<{ status: number; isError: boolean; result: any; headers: Headers }> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
  if (res.status !== 200) return { status: res.status, isError: true, result: await res.json().catch(() => null), headers: res.headers }
  const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }
  const text = body.result.content[0]!.text
  let result: unknown = text
  try {
    result = JSON.parse(text)
  } catch {}
  return { status: 200, isError: Boolean(body.result.isError), result, headers: res.headers }
}
