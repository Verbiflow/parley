import type { SignInKey } from "../identity/sealing.ts"
import type { SealedValue, SecretKind } from "./store.ts"

/**
 * The one seam every secret's value passes through, sealed on the way in and opened on the way out. The store keeps
 * what this makes, opaque, with its scheme/key/version and nothing else. Lifted from mako-cloud's `secrets/seal.ts`.
 *
 * `server.v1`: AES-256-GCM under the environment's `SIGN_IN_KEY`, with the record's account, kind, purpose, name and
 * version as associated data, so a value moved to another record — or an older version put back over a newer — won't
 * open.
 */
export type SecretBinding = { userId: string; kind: SecretKind; purpose: string; name: string; version: string }

export interface SecretSeal {
  seal(binding: SecretBinding, value: Uint8Array): Promise<SealedValue>
  /** Undefined for a value this seal didn't make, or made for another record. */
  open(binding: SecretBinding, sealed: SealedValue): Promise<Uint8Array | undefined>
}

const encoder = new TextEncoder()

function bound({ userId, kind, purpose, name, version }: SecretBinding): Uint8Array {
  return encoder.encode(`parley.secret.v1\0${userId}\0${kind}\0${purpose}\0${name}\0${version}`)
}

export function serverSeal(key: SignInKey): SecretSeal {
  return {
    async seal(binding, value) {
      const sealed = await key.sealBytes(bound(binding), value)
      return { scheme: "server.v1", keyId: sealed.key, iv: sealed.iv, sealed: sealed.data }
    },
    async open(binding, sealed) {
      if (sealed.scheme !== "server.v1") return undefined
      return key.openBytes(bound(binding), { key: sealed.keyId, iv: sealed.iv, data: sealed.sealed })
    },
  }
}
