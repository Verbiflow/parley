import type { Sql } from "../db/database.ts"
import { hashSecret, newSecret } from "./credentials.ts"

/**
 * Parley's identity operations against Postgres. A focused re-homing of the parts of mako-cloud's `identity/store.ts`
 * Parley needs — accounts, browser sessions, the device-code grant, device enrollment and entitlements — calling
 * `RequestDatabase` directly instead of mako's records-Worker RPC. Only credential *hashes* are ever stored.
 */

export type Account = { id: string; email: string; name: string }
export type SignInMethod = "github" | "google" | "local" | "proof"
export type DeviceCodeKind = "runtime" | "cli"

/** Create or refresh an account by its provider subject (`<provider>:<id>`). */
export async function upsertAccount(
  sql: Sql,
  person: { subject: string; email: string; name: string; image?: string | null; signedInWith: SignInMethod; githubId?: string | null }
): Promise<Account> {
  const [row] = await sql<{ id: string; email: string; name: string }>(
    `insert into identity.account (subject, email, name, image, signed_in_with, github_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (subject) do update set
       email = excluded.email, name = excluded.name, image = excluded.image,
       signed_in_with = excluded.signed_in_with, github_id = excluded.github_id, signed_in_at = now()
     returning id, email, name`,
    [person.subject, person.email, person.name, person.image ?? null, person.signedInWith, person.githubId ?? null]
  )
  return row!
}

// ---- Browser sessions -------------------------------------------------------

/** Start a browser session for a signed-in account; returns the session id. Only the token's hash is stored. */
export async function startBrowserSession(
  sql: Sql,
  session: { userId: string; tokenHash: string; method: SignInMethod; expiresAt: Date; providerSession?: string | null; userAgent?: string | null }
): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }>(
    `insert into identity.browser_session (token_hash, user_id, provider_session, expires_at, method, user_agent)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [session.tokenHash, session.userId, session.providerSession ?? null, session.expiresAt, session.method, session.userAgent ?? null]
  )
  return row!
}

// A live session, with last_seen_at bumped at most once a minute: every dashboard page reads the session, and a write
// per page view was a wasted round trip that also churned the row.
const LIVE_SESSION = `with s as (
    select id, user_id, last_seen_at from identity.browser_session where token_hash = $1 and expires_at > now()
  ), touch as (
    update identity.browser_session b set last_seen_at = now() from s
     where b.id = s.id and s.last_seen_at < now() - interval '1 minute'
  )`

/** The account a live session token belongs to, or undefined if unknown/expired. Touches last_seen_at. */
export async function sessionByToken(sql: Sql, tokenHash: string): Promise<{ userId: string; id: string } | undefined> {
  const [row] = await sql<{ user_id: string; id: string }>(`${LIVE_SESSION} select id, user_id from s`, [tokenHash])
  return row && { userId: row.user_id, id: row.id }
}

/** `sessionByToken` and `accountById` in one round trip: what every dashboard page needs first. */
export async function sessionProfileByToken(sql: Sql, tokenHash: string): Promise<{ sessionId: string; profile: Profile } | undefined> {
  const [row] = await sql<{ session_id: string; id: string; email: string; name: string; image: string | null; signed_in_with: SignInMethod | null; created_at: Date }>(
    `${LIVE_SESSION}
     select s.id as session_id, a.id, a.email, a.name, a.image, a.signed_in_with, a.created_at
       from s join identity.account a on a.id = s.user_id`,
    [tokenHash]
  )
  return row && { sessionId: row.session_id, profile: { id: row.id, email: row.email, name: row.name, image: row.image, signedInWith: row.signed_in_with, createdAt: row.created_at.toISOString() } }
}

// ---- Device-code grant (RFC 8628) ------------------------------------------

/** Record a freshly-issued device code (only its hash is kept). */
export async function createDeviceCode(
  sql: Sql,
  code: { deviceCodeHash: string; userCode: string; deviceKind: DeviceCodeKind; deviceName: string; platform: string; appVersion?: string | null; intervalSeconds: number; expiresAt: Date }
): Promise<void> {
  await sql(
    `insert into identity.device_code (device_code_hash, user_code, device_kind, device_name, platform, app_version, interval_seconds, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [code.deviceCodeHash, code.userCode, code.deviceKind, code.deviceName, code.platform, code.appVersion ?? null, code.intervalSeconds, code.expiresAt]
  )
}

/** What the approval page shows for a typed user code, or undefined if unknown/expired. */
export async function deviceCodeForApproval(
  sql: Sql,
  userCode: string
): Promise<{ status: string; deviceKind: string; deviceName: string; platform: string } | undefined> {
  const [row] = await sql<{ status: string; device_kind: string; device_name: string; platform: string }>(
    `select status, device_kind, device_name, platform from identity.device_code where user_code = $1 and expires_at > now()`,
    [userCode]
  )
  return row && { status: row.status, deviceKind: row.device_kind, deviceName: row.device_name, platform: row.platform }
}

/** Approve a pending device code for an account. Returns false if it wasn't pending/was expired. */
export async function approveDeviceCode(sql: Sql, userCode: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_code: string }>(
    `update identity.device_code set status = 'approved', user_id = $2
     where user_code = $1 and status = 'pending' and expires_at > now()
     returning user_code`,
    [userCode, userId]
  )
  return rows.length > 0
}

/** Deny a pending device code. */
export async function denyDeviceCode(sql: Sql, userCode: string): Promise<boolean> {
  const rows = await sql<{ user_code: string }>(
    `update identity.device_code set status = 'denied' where user_code = $1 and status = 'pending' returning user_code`,
    [userCode]
  )
  return rows.length > 0
}

export type Poll =
  | { state: "pending" }
  | { state: "denied" }
  | { state: "expired" }
  | { state: "spent" }
  | { state: "approved"; userId: string; deviceId: string; credential: string }

/**
 * The device's poll (RFC 8628 token endpoint). When the code has been approved, this atomically claims it (so two
 * polls can't both win), enrolls the device with a freshly-minted credential, and returns that credential once.
 */
export async function pollDeviceCode(sql: Sql, deviceCodeHash: string): Promise<Poll> {
  // Atomically claim an approved code so only one poll enrolls a device.
  const [claimed] = await sql<{ user_id: string; device_kind: string; device_name: string; platform: string; app_version: string | null }>(
    `update identity.device_code set status = 'spent', polled_at = now()
     where device_code_hash = $1 and status = 'approved' and expires_at > now()
     returning user_id, device_kind, device_name, platform, app_version`,
    [deviceCodeHash]
  )
  if (claimed) {
    const credential = newSecret("parley_dc")
    const [device] = await sql<{ id: string }>(
      `insert into identity.device (user_id, kind, name, platform, app_version, credential_hash, enrolled_by)
       values ($1, $2, $3, $4, $5, $6, 'device-code')
       returning id`,
      [claimed.user_id, claimed.device_kind, claimed.device_name, claimed.platform, claimed.app_version, await hashSecret(credential)]
    )
    return { state: "approved", userId: claimed.user_id, deviceId: device!.id, credential }
  }
  const [row] = await sql<{ status: string }>(
    `update identity.device_code set polled_at = now() where device_code_hash = $1 returning status`,
    [deviceCodeHash]
  )
  if (!row) return { state: "expired" }
  if (row.status === "pending") return { state: "pending" }
  if (row.status === "denied") return { state: "denied" }
  return { state: "spent" }
}

/** A live device by its credential's hash (for issuing/renewing connection tokens), or undefined if unknown/revoked. */
export async function deviceByCredential(
  sql: Sql,
  credentialHash: string
): Promise<{ deviceId: string; userId: string; deviceKind: DeviceCodeKind } | undefined> {
  const [row] = await sql<{ id: string; user_id: string; kind: DeviceCodeKind }>(
    `update identity.device set last_seen_at = now()
     where credential_hash = $1 and revoked_at is null
     returning id, user_id, kind`,
    [credentialHash]
  )
  return row && { deviceId: row.id, userId: row.user_id, deviceKind: row.kind }
}

// ---- Entitlements -----------------------------------------------------------

/** Grant an account an entitlement (idempotent). */
export async function grantEntitlement(sql: Sql, userId: string, kind: "cloud", grantedBy: string, note?: string): Promise<void> {
  await sql(
    `insert into identity.entitlement (user_id, kind, granted_by, note) values ($1, $2, $3, $4)
     on conflict (user_id, kind) do update set revoked_at = null, granted_by = excluded.granted_by, note = excluded.note`,
    [userId, kind, grantedBy, note ?? null]
  )
}

/** The entitlement kinds an account currently holds. */
export async function entitlements(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ kind: string }>(
    `select kind from identity.entitlement where user_id = $1 and revoked_at is null order by kind`,
    [userId]
  )
  return rows.map((row) => row.kind)
}

// ---- Profile & browser sessions (dashboard) ---------------------------------

export type Profile = { id: string; email: string; name: string; image: string | null; signedInWith: SignInMethod | null; createdAt: string }

/** The signed-in account's profile, for the dashboard. */
export async function accountById(sql: Sql, id: string): Promise<Profile | undefined> {
  const [row] = await sql<{ id: string; email: string; name: string; image: string | null; signed_in_with: SignInMethod | null; created_at: Date }>(
    `select id, email, name, image, signed_in_with, created_at from identity.account where id = $1`,
    [id]
  )
  return row && { id: row.id, email: row.email, name: row.name, image: row.image, signedInWith: row.signed_in_with, createdAt: row.created_at.toISOString() }
}

export type BrowserSessionView = { id: string; method: SignInMethod | null; userAgent: string | null; createdAt: string; lastSeenAt: string }

/** The account's live browser sessions, most recently used first. */
export async function browserSessions(sql: Sql, userId: string): Promise<BrowserSessionView[]> {
  const rows = await sql<{ id: string; method: SignInMethod | null; user_agent: string | null; created_at: Date; last_seen_at: Date }>(
    `select id, method, user_agent, created_at, last_seen_at from identity.browser_session
     where user_id = $1 and expires_at > now() order by last_seen_at desc limit 50`,
    [userId]
  )
  return rows.map((r) => ({ id: r.id, method: r.method, userAgent: r.user_agent, createdAt: r.created_at.toISOString(), lastSeenAt: r.last_seen_at.toISOString() }))
}

/** End one of the account's browser sessions by its public id. */
export async function endBrowserSession(sql: Sql, userId: string, id: string): Promise<void> {
  await sql(`delete from identity.browser_session where user_id = $1 and id = $2`, [userId, id])
}

/** End every browser session for the account except (optionally) one. */
export async function endOtherBrowserSessions(sql: Sql, userId: string, keepId?: string): Promise<void> {
  await sql(`delete from identity.browser_session where user_id = $1 and ($2::uuid is null or id <> $2::uuid)`, [userId, keepId ?? null])
}
