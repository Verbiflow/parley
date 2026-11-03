import { initAuthCreds, BufferJSON, proto, type AuthenticationState } from "@whiskeysockets/baileys"

/**
 * Baileys' auth state (creds + the signal key store) as a single serializable blob. Parley keeps this as the channel's
 * opaque `state` — emitted on every `creds.update`, sealed by the session pool, and handed back on reconnect. Using
 * `BufferJSON` preserves the binary keys across JSON. Keys live in memory here; no files on disk.
 */
export type SerializableAuthState = { state: AuthenticationState; serialize: () => string }

export function makeAuthState(serialized?: string): SerializableAuthState {
  const data = serialized ? JSON.parse(serialized, BufferJSON.reviver) : { creds: initAuthCreds(), keys: {} }
  const creds = data.creds
  const keys: Record<string, Record<string, unknown>> = data.keys ?? {}

  const keyStore = {
    get(type: string, ids: string[]) {
      const out: Record<string, unknown> = {}
      const store = keys[type] ?? {}
      for (const id of ids) {
        let value = store[id]
        if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
        out[id] = value
      }
      return out
    },
    set(data: Record<string, Record<string, unknown>>) {
      for (const type of Object.keys(data)) {
        keys[type] = keys[type] ?? {}
        Object.assign(keys[type]!, data[type])
      }
    },
  }

  const state = { creds, keys: keyStore } as unknown as AuthenticationState
  return { state, serialize: () => JSON.stringify({ creds, keys }, BufferJSON.replacer) }
}
