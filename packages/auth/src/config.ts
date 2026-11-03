import { z } from "zod"

/**
 * Parley's settings, parsed once. Deliberately small: Parley is a messaging gateway, not a machine host. The
 * identity-related keys (`SIGN_IN_KEY`, `CONNECTION_SIGNING_KEY`, WorkOS) keep mako-cloud's names and meanings so the
 * lifted auth reads them unchanged.
 */

export const ENVIRONMENT_NAME = /^(local|staging|production|dev-[a-z0-9][a-z0-9-]{0,19})$/

/** The local environment's own signing key (public test material). Every other environment must set its own. */
export const LOCAL_SIGNING_KEY = '{"crv":"Ed25519","d":"jNcA1J6uXCpHiI0ew1SsgjX1ai-n6IyRiLe9UtiNe9g","x":"-ozV7Auj5plpkgH2NUAUy7URvMB4-1Ucax0Sf2ULcx0","kty":"OKP","kid":"local-7oa8oIk5","alg":"EdDSA"}'

/** The local environment's sealing key (public test material): 32 bytes, base64url. */
export const LOCAL_SIGN_IN_KEY = "n6-YuBdARfZG1VCRRUUc8PZdo7j1oTREECMvGEUYNRs"

const schema = z.object({
  PARLEY_ENV: z.string().regex(ENVIRONMENT_NAME, "expected local, staging, production or dev-<name>").default("local"),
  PARLEY_VERSION: z.string().min(1).default("dev"),
  /** Postgres (RDS) connection string. `sslmode=require` in every deployed environment. */
  DATABASE_URL: z.string().min(1).optional(),
  /** Redis connection string for the connection→worker registry and pub/sub. Absent locally where sessions run in-process. */
  REDIS_URL: z.string().min(1).optional(),
  /** Seals channel credentials and other secrets (`identity/sealing.ts`): 32 bytes, base64url. */
  SIGN_IN_KEY: z.string().regex(/^[\w-]{43}$/, "expected 32 bytes, base64url").optional(),
  /** A private Ed25519 JWK (JSON) that signs connection tokens. */
  CONNECTION_SIGNING_KEY: z.string().min(1).optional(),
  /** Retired public JWKs (JSON array), still accepted until their tokens expire. */
  CONNECTION_VERIFY_KEYS: z.string().min(1).optional(),
  /** Locally/in dev only: shorter connection tokens, to watch renewal happen. */
  CONNECTION_TOKEN_SECONDS: z.coerce.number().int().min(15).max(300).optional(),
  /** How long a browser's sign-in session lasts. */
  BROWSER_SESSION_SECONDS: z.coerce.number().int().min(300).default(60 * 60 * 24 * 14),
  /** Where people reach this environment; locally, whichever address the request came in on. */
  PUBLIC_URL: z.string().url().optional(),
  WORKOS_CLIENT_ID: z.string().regex(/^client_\w+$/, "expected a WorkOS client ID, client_…").optional(),
  WORKOS_API_KEY: z.string().regex(/^sk_\w+$/, "expected a WorkOS API key, sk_…").optional(),
})

export type IdentityConfig = {
  env: string
  version: string
  databaseUrl: string | undefined
  redisUrl: string | undefined
  publicUrl: string | undefined
  /** Seals channel credentials; absent only where the environment keeps none. */
  signInKey: string
  /** Private Ed25519 JWK (JSON). */
  signingKey: string
  verifyKeys: string | undefined
  tokenSeconds: number | undefined
  browserSessionSeconds: number
  workos: { clientId: string; apiKey: string } | undefined
  /** A test sign-in that just asks for a name and email: local only. */
  localProvider: boolean
}

export class ConfigError extends Error {
  readonly settings: string[]
  constructor(settings: string[]) {
    super(`invalid settings: ${settings.join(", ")}`)
    this.name = "ConfigError"
    this.settings = settings
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const result = schema.safeParse(env)
  if (!result.success) throw new ConfigError([...new Set(result.error.issues.map((issue) => issue.path.join(".")))])
  const s = result.data
  const local = s.PARLEY_ENV === "local"
  const missing: string[] = []

  const signInKey = s.SIGN_IN_KEY ?? (local ? LOCAL_SIGN_IN_KEY : undefined)
  if (!signInKey) missing.push("SIGN_IN_KEY")
  if (!local && signInKey === LOCAL_SIGN_IN_KEY) missing.push("SIGN_IN_KEY")

  const signingKey = s.CONNECTION_SIGNING_KEY ?? (local ? LOCAL_SIGNING_KEY : undefined)
  if (!signingKey) missing.push("CONNECTION_SIGNING_KEY")
  if (!local && signingKey === LOCAL_SIGNING_KEY) missing.push("CONNECTION_SIGNING_KEY")

  const { WORKOS_CLIENT_ID: clientId, WORKOS_API_KEY: apiKey } = s
  if (clientId && !apiKey) missing.push("WORKOS_API_KEY")
  if (apiKey && !clientId) missing.push("WORKOS_CLIENT_ID")
  if (!local && !clientId) missing.push("WORKOS_CLIENT_ID")
  if (s.CONNECTION_TOKEN_SECONDS !== undefined && !local && !s.PARLEY_ENV.startsWith("dev-")) missing.push("CONNECTION_TOKEN_SECONDS")

  if (missing.length) throw new ConfigError([...new Set(missing)])

  return {
    env: s.PARLEY_ENV,
    version: s.PARLEY_VERSION,
    databaseUrl: s.DATABASE_URL,
    redisUrl: s.REDIS_URL,
    publicUrl: s.PUBLIC_URL,
    signInKey: signInKey!,
    signingKey: signingKey!,
    verifyKeys: s.CONNECTION_VERIFY_KEYS,
    tokenSeconds: s.CONNECTION_TOKEN_SECONDS,
    browserSessionSeconds: s.BROWSER_SESSION_SECONDS,
    workos: clientId && apiKey ? { clientId, apiKey } : undefined,
    localProvider: local,
  }
}
