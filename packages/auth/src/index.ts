// @parley/auth — identity lifted from mako-cloud, re-homed on plain Node + Postgres.
export { RequestDatabase, type Sql, type Row } from "./db/database.ts"
export { migrate, MIGRATIONS, type Applied } from "./db/migrate.ts"
export { readConfig, ConfigError, LOCAL_SIGNING_KEY, LOCAL_SIGN_IN_KEY, type IdentityConfig } from "./config.ts"

export { base64url, hashSecret, newSecret, newUserCode, normalizeUserCode, pkceMatches, isLoopbackRedirect } from "./identity/credentials.ts"
export { SignInKey, signInKey, unbase64url, type Sealed } from "./identity/sealing.ts"
export { tokenKeys, CONNECTION_TOKEN_SECONDS, InvalidTokenError, type TokenConfig, type TokenKeys, type Principal, type DeviceKind } from "./identity/tokens.ts"
export * as store from "./identity/store.ts"

export { serverSeal, type SecretSeal, type SecretBinding } from "./secrets/seal.ts"
export * as secrets from "./secrets/store.ts"
export { SECRET_KINDS, type SecretKind, type SealedValue } from "./secrets/store.ts"
