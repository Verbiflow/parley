import assert from "node:assert/strict"
import { test } from "node:test"
import { LOCAL_SIGN_IN_KEY, LOCAL_SIGNING_KEY } from "../src/config.ts"
import { hashSecret, newUserCode, newSecret, normalizeUserCode, pkceMatches } from "../src/identity/credentials.ts"
import { SignInKey } from "../src/identity/sealing.ts"
import { tokenKeys, InvalidTokenError } from "../src/identity/tokens.ts"
import { serverSeal } from "../src/secrets/seal.ts"
import { saveSecret, readSecret } from "../src/secrets/store.ts"
import * as store from "../src/identity/store.ts"
import { testDatabase } from "./database.ts"

const { sql } = await testDatabase()

test("migrations create the identity and secret schemas", async () => {
  const rows = await sql<{ schema_name: string }>(`select schema_name from information_schema.schemata where schema_name in ('identity', 'secret')`)
  assert.deepEqual(rows.map((r) => r.schema_name).sort(), ["identity", "secret"])
})

test("user codes are well-formed and normalize what people type", () => {
  const code = newUserCode()
  assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
  assert.equal(normalizeUserCode(code.toLowerCase().replace("-", " ")), code)
  assert.equal(normalizeUserCode("not a code"), undefined)
})

test("PKCE S256 matches a verifier to its challenge", async () => {
  // challenge = base64url(sha256(verifier)); hashSecret is exactly that.
  const verifier = newSecret("parley_dvc")
  const challenge = await hashSecret(verifier)
  assert.equal(await pkceMatches(verifier, challenge), true)
  assert.equal(await pkceMatches("wrong", challenge), false)
})

test("SignInKey seals and opens, bound to its associated data", async () => {
  const key = await SignInKey.from(LOCAL_SIGN_IN_KEY)
  const bound = new TextEncoder().encode("ctx-a")
  const other = new TextEncoder().encode("ctx-b")
  const secret = new TextEncoder().encode("whatsapp-session-creds")
  const sealed = await key.sealBytes(bound, secret)
  assert.deepEqual([...(await key.openBytes(bound, sealed))!], [...secret])
  assert.equal(await key.openBytes(other, sealed), undefined) // wrong binding won't open
})

test("connection tokens round-trip and reject tampering/expiry", async () => {
  const keys = await tokenKeys({ signingKey: LOCAL_SIGNING_KEY }, "local")
  const principal = { userId: "11111111-1111-1111-1111-111111111111", deviceId: "22222222-2222-2222-2222-222222222222", deviceKind: "cli" as const, entitlements: ["cloud"] }
  const { token } = await keys.sign(principal)
  const verified = await keys.verify(token)
  assert.equal(verified.userId, principal.userId)
  assert.deepEqual(verified.entitlements, ["cloud"])
  await assert.rejects(keys.verify(token + "x"), (e) => e instanceof InvalidTokenError)

  const { SignJWT, importJWK } = await import("jose")
  const short = await tokenKeys({ signingKey: LOCAL_SIGNING_KEY, tokenSeconds: 15 }, "local")
  const expired = await new SignJWT({ did: principal.deviceId, dkd: "cli", ent: [] })
    .setProtectedHeader({ alg: "EdDSA", kid: JSON.parse(LOCAL_SIGNING_KEY).kid, typ: "JWT" })
    .setSubject(principal.userId).setIssuer("parley:local").setAudience("parley:local:connect")
    .setIssuedAt(0).setExpirationTime(1).sign(await importJWK({ ...JSON.parse(LOCAL_SIGNING_KEY), alg: "EdDSA" }, "EdDSA"))
  await assert.rejects(short.verify(expired), (e) => e instanceof InvalidTokenError && e.reason === "expired")
})

test("sealed secret store: save then read round-trips through Postgres", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:a@parley.test", email: "a@parley.test", name: "A", signedInWith: "local" })
  const seal = serverSeal(await SignInKey.from(LOCAL_SIGN_IN_KEY))
  const scope = { userId: account.id, kind: "channel-creds" as const, purpose: "whatsapp" }
  const name = "conn-1"
  const version = crypto.randomUUID()
  const plain = new TextEncoder().encode(JSON.stringify({ noiseKey: "secret", registered: true }))
  const sealed = await seal.seal({ ...scope, name, version }, plain)
  await saveSecret(sql, { ...scope, name, version, bytes: plain.length, ...sealed })

  const got = await readSecret(sql, scope, name)
  assert.ok(got)
  const opened = await seal.open({ ...scope, name, version: got.version }, got)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(opened)), { noiseKey: "secret", registered: true })
})

test("device-code grant: create → approve → poll enrolls a device and returns a credential", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:dev@parley.test", email: "dev@parley.test", name: "Dev", signedInWith: "local" })
  const deviceCode = newSecret("parley_dc")
  const userCode = newUserCode()
  await store.createDeviceCode(sql, {
    deviceCodeHash: await hashSecret(deviceCode), userCode, deviceKind: "cli", deviceName: "Hearth", platform: "linux",
    intervalSeconds: 5, expiresAt: new Date(Date.now() + 900_000),
  })

  // Before approval the device keeps polling.
  assert.equal((await store.pollDeviceCode(sql, await hashSecret(deviceCode))).state, "pending")

  // The browser approves (what the approval page does after sign-in).
  const forApproval = await store.deviceCodeForApproval(sql, userCode)
  assert.equal(forApproval?.deviceName, "Hearth")
  assert.equal(await store.approveDeviceCode(sql, userCode, account.id), true)

  // The next poll claims it, enrolls the device, and hands back the credential once.
  const poll = await store.pollDeviceCode(sql, await hashSecret(deviceCode))
  assert.equal(poll.state, "approved")
  if (poll.state !== "approved") return
  assert.equal(poll.userId, account.id)
  assert.match(poll.credential, /^parley_dc_/)

  // That credential identifies the enrolled device (how connection tokens are later issued).
  const device = await store.deviceByCredential(sql, await hashSecret(poll.credential))
  assert.equal(device?.deviceId, poll.deviceId)
  assert.equal(device?.userId, account.id)

  // A second poll can't enroll a second device — the code was spent.
  assert.equal((await store.pollDeviceCode(sql, await hashSecret(deviceCode))).state, "spent")
})
