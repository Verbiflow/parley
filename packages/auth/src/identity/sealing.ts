import type { webcrypto } from "node:crypto"
import { base64url } from "./credentials.ts"

/**
 * AES-256-GCM sealing under the environment's key (`SIGN_IN_KEY`, 32 bytes base64url). Every secret Parley stores —
 * a channel's session credentials, a saved key — is sealed with this before it reaches the database, bound by its
 * associated data to the record it belongs to, so a sealed value moved to another account/channel won't open and a
 * database dump on its own decrypts nothing (the key is never in the database).
 *
 * Lifted from mako-cloud's `identity/sign-ins.ts` (the `SignInKey` class), with the harness-specific vault left
 * behind. `BufferSource` is narrowed to `Uint8Array` so it type-checks on plain Node.
 */
export class SignInKey {
  readonly id: string
  readonly #key: webcrypto.CryptoKey

  private constructor(id: string, key: webcrypto.CryptoKey) {
    this.id = id
    this.#key = key
  }

  /** `SIGN_IN_KEY`: 32 random bytes, base64url. */
  static async from(raw: string): Promise<SignInKey> {
    const bytes = unbase64url(raw)
    if (bytes.length !== 32) throw new Error("SIGN_IN_KEY is 32 bytes, base64url")
    const id = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).slice(0, 12)
    return new SignInKey(id, await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]))
  }

  /** Any bytes, bound to `bound` as their associated data: what every secret this environment keeps is sealed with. */
  async sealBytes(bound: Uint8Array, bytes: Uint8Array): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bound }, this.#key, bytes)
    return { key: this.id, iv: base64url(iv), data: base64url(new Uint8Array(data)) }
  }

  /** Undefined for bytes sealed by another key, or bound to anything else. */
  async openBytes(bound: Uint8Array, sealed: Sealed): Promise<Uint8Array | undefined> {
    if (sealed.key !== this.id) return undefined
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(sealed.iv), additionalData: bound }, this.#key, unbase64url(sealed.data)))
    } catch {
      return undefined
    }
  }
}

/** A sealed blob: the key that made it, the nonce, and the ciphertext — all base64url, all safe to store. */
export type Sealed = { key: string; iv: string; data: string }

const keys = new Map<string, Promise<SignInKey>>()

/** The environment's key, imported once per process. */
export function signInKey(raw: string): Promise<SignInKey> {
  let key = keys.get(raw)
  if (!key) keys.set(raw, (key = SignInKey.from(raw)))
  return key
}

export function unbase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0))
}
