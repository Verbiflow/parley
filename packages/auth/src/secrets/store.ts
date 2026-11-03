import type { Sql } from "../db/database.ts"

/**
 * The account's secret store in Postgres (`migrations/0006_secrets.sql`): one record shape for every kind of secret,
 * each value sealed before it gets here (`seal.ts`). Adapted from mako-cloud's `secrets/store.ts` — the thread/machine
 * read-logging is dropped (Parley has no threads), leaving a plain sealed key/value store.
 *
 * Parley's own use is `kind: "channel-creds"`, `purpose: "<channel>"`, `name: "<connectionId>"`: a channel's sealed
 * session credentials for one connection.
 */

/** `proxy-creds` values are sealed inline on the proxy tables (the hosted pool has no owning account), never stored here. */
export const SECRET_KINDS = ["saved-key", "channel-creds", "proxy-creds"] as const
export type SecretKind = (typeof SECRET_KINDS)[number]

/** How a value is sealed. `server.v1`: AES-256-GCM under the environment's key, bound to its record (`seal.ts`). */
export type SecretScheme = "server.v1"

/** The most records one purpose keeps. */
export const SECRETS_PER_PURPOSE = 200

/** Which records: one account's, of one kind, for one thing. */
export type SecretScope = { userId: string; kind: SecretKind; purpose: string }

/** A sealed value with how it was sealed: opened only by the seal that made it. */
export type SealedValue = { scheme: SecretScheme; keyId: string; iv: string; sealed: string }

/** A record as it's listed: everything but the value. */
export type SecretListing = { name: string; version: string; bytes: number; savedAt: string; expiresAt: string | null }
export type SecretRead = SecretListing & SealedValue
export type SecretWrite = SecretScope & SealedValue & { name: string; version: string; bytes: number; expiresAt?: string | null }

type Row = { name: string; version: string; bytes: number; saved_at: Date; expires_at: Date | null }
type SealedRow = Row & { scheme: SecretScheme; key_id: string; iv: string; sealed: string }

const listed = (row: Row): SecretListing => ({
  name: row.name,
  version: row.version,
  bytes: row.bytes,
  savedAt: row.saved_at.toISOString(),
  expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
})

/** Saves a record, replacing the one of the same name, unless the purpose already holds `SECRETS_PER_PURPOSE` others. */
export async function saveSecret(sql: Sql, write: SecretWrite): Promise<SecretListing | undefined> {
  const [row] = await sql<Row>(
    `insert into secret.record (user_id, kind, purpose, name, version, scheme, key_id, iv, sealed, bytes, expires_at)
     select $1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11
     where (select count(*) from secret.record where user_id = $1 and kind = $2 and purpose = $3 and name <> $4) < $12
     on conflict (user_id, kind, purpose, name) do update set
       version = excluded.version, scheme = excluded.scheme, key_id = excluded.key_id, iv = excluded.iv,
       sealed = excluded.sealed, bytes = excluded.bytes, expires_at = excluded.expires_at, saved_at = now()
     returning name, version, bytes, saved_at, expires_at`,
    [write.userId, write.kind, write.purpose, write.name, write.version, write.scheme, write.keyId, write.iv, write.sealed, write.bytes, write.expiresAt ?? null, SECRETS_PER_PURPOSE]
  )
  return row && listed(row)
}

/** One record's sealed value by name, or undefined. */
export async function readSecret(sql: Sql, scope: SecretScope, name: string): Promise<SecretRead | undefined> {
  const [row] = await sql<SealedRow>(
    `select name, version, bytes, saved_at, expires_at, scheme, key_id, iv, sealed from secret.record
     where user_id = $1 and kind = $2 and purpose = $3 and name = $4`,
    [scope.userId, scope.kind, scope.purpose, name]
  )
  return row && { ...listed(row), scheme: row.scheme, keyId: row.key_id, iv: row.iv, sealed: row.sealed }
}

/** What a purpose holds, by name, without any value. */
export async function listSecrets(sql: Sql, scope: SecretScope): Promise<SecretListing[]> {
  const rows = await sql<Row>(
    `select name, version, bytes, saved_at, expires_at from secret.record where user_id = $1 and kind = $2 and purpose = $3 order by name collate "C"`,
    [scope.userId, scope.kind, scope.purpose]
  )
  return rows.map(listed)
}

/** Removes one record by name, or with `name` null every record of the purpose; answers the names removed. */
export async function removeSecrets(sql: Sql, scope: SecretScope, name: string | null): Promise<string[]> {
  const rows = await sql<{ name: string }>(
    `delete from secret.record where user_id = $1 and kind = $2 and purpose = $3 and ($4::text is null or name = $4) returning name`,
    [scope.userId, scope.kind, scope.purpose, name]
  )
  return rows.map((row) => row.name).sort()
}
