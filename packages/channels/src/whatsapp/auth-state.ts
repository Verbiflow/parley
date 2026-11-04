import { initAuthCreds, BufferJSON, proto, type AuthenticationState } from "@whiskeysockets/baileys"

/**
 * Baileys' auth state (creds + the signal key store) as a single serializable blob. Parley keeps this as the channel's
 * opaque `state` — emitted on every `creds.update`, sealed by the session pool, and handed back on reconnect. Using
 * `BufferJSON` preserves the binary keys across JSON. Keys live in memory here; no files on disk.
 *
 * `onKeysChange` fires on every key-store write. The per-contact encryption sessions change on each message sent or
 * received, without any `creds.update`. If they aren't saved, a reconnect restores older keys than the other side
 * has, and their phone can't decrypt what we send ("Waiting for this message").
 */
export type SerializableAuthState = { state: AuthenticationState; serialize: () => string }

export function makeAuthState(serialized?: string, onKeysChange?: () => void): SerializableAuthState {
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
        const store = (keys[type] = keys[type] ?? {})
        for (const [id, value] of Object.entries(data[type] ?? {})) {
          // Baileys deletes a key (a used pre-key, a closed session) by setting it to null.
          if (value === null || value === undefined) delete store[id]
          else store[id] = value
        }
      }
      onKeysChange?.()
    },
  }

  const state = { creds, keys: keyStore } as unknown as AuthenticationState
  return { state, serialize: () => JSON.stringify({ creds, keys }, BufferJSON.replacer) }
}
