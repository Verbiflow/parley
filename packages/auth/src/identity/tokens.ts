import { type JWK, SignJWT, errors, importJWK, jwtVerify } from "jose"
import { z } from "zod"

/**
 * Connection tokens: short-lived EdDSA JWTs a device exchanges its long-lived credential for, verified with nothing
 * but a signature check (no database on the way in). Lifted from mako-cloud's `identity/tokens.ts`; the only change
 * is that the signing config is passed in as `TokenConfig` rather than read from mako's wider `IdentityConfig`.
 */

/** Short enough that a removed device is shut out within minutes even if nothing else tells the gateway. */
export const CONNECTION_TOKEN_SECONDS = 300

export const DeviceKindSchema = z.enum(["desktop", "runtime", "cli", "browser"])
export type DeviceKind = z.infer<typeof DeviceKindSchema>

/** Who a connection token speaks for, read from the token alone. */
export type Principal = {
  userId: string
  deviceId: string
  deviceKind: DeviceKind
  entitlements: string[]
  expiresAt: number
}

/** What `tokenKeys` needs: a private signing JWK, optional retired public JWKs, and an optional shorter lifetime. */
export type TokenConfig = {
  /** A private Ed25519 JWK, as JSON; its `kid` names it in every token it signs. */
  signingKey: string
  /** Public JWKs of retired signing keys, as a JSON array, still accepted until their tokens expire. */
  verifyKeys?: string | undefined
  /** Shorter connection tokens than the usual five minutes, locally or in a dev environment. */
  tokenSeconds?: number | undefined
}

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  did: z.string().uuid(),
  dkd: DeviceKindSchema,
  ent: z.array(z.string()),
  exp: z.number().int(),
})

const PrivateKeySchema = z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), d: z.string(), x: z.string(), kid: z.string().min(1) })
const PublicKeySchema = z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), kid: z.string().min(1) })

export class InvalidTokenError extends Error {
  readonly reason: "expired" | "invalid"

  constructor(reason: "expired" | "invalid", cause?: unknown) {
    super(reason === "expired" ? "The connection token has expired" : "The connection token isn't valid here", { cause })
    this.name = "InvalidTokenError"
    this.reason = reason
  }
}

export type TokenKeys = {
  sign(principal: Omit<Principal, "expiresAt">): Promise<{ token: string; expiresAt: number }>
  verify(token: string): Promise<Principal>
  /** The public half of every key still accepted, for anyone verifying tokens away from the gateway. */
  jwks: { keys: JWK[] }
}

const loaded = new WeakMap<TokenConfig, Promise<TokenKeys>>()

/** Parsed and imported once per config object: verifying a token is then a signature check and nothing more. */
export function tokenKeys(config: TokenConfig, env: string): Promise<TokenKeys> {
  let keys = loaded.get(config)
  if (!keys) {
    keys = load(config, env)
    loaded.set(config, keys)
  }
  return keys
}

async function load(config: TokenConfig, env: string): Promise<TokenKeys> {
  const signing = PrivateKeySchema.parse(JSON.parse(config.signingKey))
  const retired = z.array(PublicKeySchema).parse(config.verifyKeys ? JSON.parse(config.verifyKeys) : [])
  const current = { kid: signing.kid, kty: signing.kty, crv: signing.crv, x: signing.x }
  const privateKey = await importJWK({ ...signing, alg: "EdDSA" }, "EdDSA")
  const publicKeys = new Map<string, Awaited<ReturnType<typeof importJWK>>>()
  for (const key of [current, ...retired]) publicKeys.set(key.kid, await importJWK({ ...key, alg: "EdDSA" }, "EdDSA"))
  const issuer = `parley:${env}`
  const audience = `parley:${env}:connect`
  return {
    async sign(principal) {
      const expiresAt = Math.floor(Date.now() / 1000) + (config.tokenSeconds ?? CONNECTION_TOKEN_SECONDS)
      const token = await new SignJWT({ did: principal.deviceId, dkd: principal.deviceKind, ent: principal.entitlements })
        .setProtectedHeader({ alg: "EdDSA", kid: signing.kid, typ: "JWT" })
        .setSubject(principal.userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(privateKey)
      return { token, expiresAt }
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, async (header) => {
          const key = header.kid ? publicKeys.get(header.kid) : undefined
          if (!key) throw new InvalidTokenError("invalid")
          return key
        }, { issuer, audience, algorithms: ["EdDSA"], clockTolerance: 5 })
        const claims = ClaimsSchema.parse(payload)
        return { userId: claims.sub, deviceId: claims.did, deviceKind: claims.dkd, entitlements: claims.ent, expiresAt: claims.exp }
      } catch (error) {
        if (error instanceof InvalidTokenError) throw error
        throw new InvalidTokenError(error instanceof errors.JWTExpired ? "expired" : "invalid", error)
      }
    },
    jwks: { keys: [current, ...retired].map((key) => ({ ...key, alg: "EdDSA", use: "sig" })) },
  }
}
