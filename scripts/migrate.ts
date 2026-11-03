import { Client } from "pg"
import { migrate, MIGRATIONS } from "@parley/auth/migrate"

/** Apply all migrations to DATABASE_URL. Run: `DATABASE_URL=... node scripts/migrate.ts` (or `npm run migrate`). */
const url = process.env.DATABASE_URL
if (!url) {
  console.error("set DATABASE_URL (e.g. postgres://postgres@127.0.0.1:5432/parley)")
  process.exit(1)
}
const client = new Client({ connectionString: url })
await client.connect()
const applied = await migrate(client, MIGRATIONS)
await client.end()
console.log(applied.length ? `applied ${applied.length} migration(s): ${applied.map((a) => a.name).join(", ")}` : "database already up to date")
