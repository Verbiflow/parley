import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Client } from "pg"

// Guarded so this module can load where there's no filesystem (the edge Worker bundles @parley/auth); migrations
// only ever run from Node.
export const MIGRATIONS = typeof import.meta.dirname === "string" ? join(import.meta.dirname, "../../migrations") : ""
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/
/** Any number, so two migrators never interleave; each takes it for its whole run. */
const LOCK = 7_262_001

export type Applied = { name: string; ms: number }

/**
 * Applies the migrations this database hasn't had, in name order, each in its own transaction.
 * A file already applied with different contents is refused: migrations are written once.
 * Lifted verbatim from mako-cloud's `db/migrate.ts`.
 */
export async function migrate(client: Client, folder: string = MIGRATIONS): Promise<Applied[]> {
  const files = (await readdir(folder)).filter((name) => NAME.test(name)).sort()
  await client.query("select pg_advisory_lock($1)", [LOCK])
  try {
    await client.query(
      "create table if not exists public.schema_migration (name text primary key, checksum text not null, applied_at timestamptz not null default now())"
    )
    const { rows } = await client.query<{ name: string; checksum: string }>("select name, checksum from public.schema_migration")
    const done = new Map(rows.map((row) => [row.name, row.checksum]))
    const applied: Applied[] = []
    for (const name of files) {
      const text = await readFile(join(folder, name), "utf8")
      const checksum = await digest(text)
      const previous = done.get(name)
      if (previous === checksum) continue
      if (previous) throw new Error(`${name} changed after it was applied; write a new migration instead`)
      const started = performance.now()
      await client.query("begin")
      try {
        await client.query(text)
        await client.query("insert into public.schema_migration (name, checksum) values ($1, $2)", [name, checksum])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw new Error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      applied.push({ name, ms: Math.round(performance.now() - started) })
    }
    return applied
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK])
  }
}

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
