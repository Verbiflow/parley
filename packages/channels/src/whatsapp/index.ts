import makeWASocket, { DisconnectReason, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys"
import type { Channel, LiveConnection, OpenOptions } from "../contract.ts"
import { makeAuthState } from "./auth-state.ts"

// Baileys wants a pino-like logger; we keep it silent. Cast once, here.
const SILENT: any = { level: "silent", child: () => SILENT, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }

/** Normalize a recipient to a WhatsApp JID: a bare phone number becomes `<digits>@s.whatsapp.net`. */
function toJid(to: string): string {
  return to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@s.whatsapp.net`
}

/**
 * The WhatsApp channel, over Baileys (unofficial WhatsApp Web multi-device). A fresh connection emits a `link` event
 * carrying the QR string; once the user scans it, `open` fires and `state` carries the creds to seal. With saved
 * state it reconnects with no QR. This is the first real `Channel` — held to the same conformance contract as the Fake
 * (via the auth-state round-trip test; the live link is validated manually, since it needs a phone).
 */
export const whatsappChannel: Channel = {
  id: "whatsapp",
  capabilities: { linkMethod: "qr", media: false, groups: true, threads: true, presence: false },

  async open({ state, emit }: OpenOptions): Promise<LiveConnection> {
    const auth = makeAuthState(state)
    let sock!: ReturnType<typeof makeWASocket>
    let stopped = false

    const connect = () => {
      sock = makeWASocket({
        auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, SILENT) },
        logger: SILENT,
        browser: ["Parley", "Chrome", "1.0"],
        syncFullHistory: false,
      })

      sock.ev.on("creds.update", () => emit({ type: "state", state: auth.serialize() }))

      sock.ev.on("connection.update", (u) => {
        if (u.qr) emit({ type: "link", method: "qr", data: u.qr })
        if (u.connection === "open") emit({ type: "open", handle: sock.user?.id ?? "" })
        if (u.connection === "close") {
          if (stopped) return
          const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
          if (code === DisconnectReason.loggedOut) {
            emit({ type: "closed", reason: "logged out" })
            return
          }
          // A transient close: an unscanned QR timing out, WhatsApp's post-scan restart (515), or a dropped
          // socket. Reconnect to re-arm the QR, finish linking, or come back online — reusing the saved creds.
          setTimeout(() => {
            if (!stopped) connect()
          }, 1000)
        }
      })

      sock.ev.on("messages.upsert", ({ messages }) => {
        for (const m of messages) {
          if (m.key.fromMe || !m.message) continue
          const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? ""
          const jid = m.key.remoteJid ?? ""
          emit({
            type: "message",
            message: { id: m.key.id ?? crypto.randomUUID(), threadId: jid, from: m.key.participant ?? jid, text, at: new Date(Number(m.messageTimestamp) * 1000 || Date.now()).toISOString() },
          })
        }
      })
    }

    connect()

    return {
      async send(to, content) {
        const res = await sock.sendMessage(toJid(to), { text: content.text })
        return { id: res?.key?.id ?? "" }
      },
      async logout() {
        stopped = true
        await sock.logout().catch(() => {})
      },
      async close() {
        stopped = true
        sock.end(undefined)
      },
    }
  },
}
