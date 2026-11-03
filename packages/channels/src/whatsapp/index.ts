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
    const sock = makeWASocket({
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
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        emit({ type: "closed", reason: code === DisconnectReason.loggedOut ? "logged out" : `closed (${code ?? "?"})` })
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

    return {
      async send(to, content) {
        const res = await sock.sendMessage(toJid(to), { text: content.text })
        return { id: res?.key?.id ?? "" }
      },
      async logout() {
        await sock.logout().catch(() => {})
      },
      async close() {
        sock.end(undefined)
      },
    }
  },
}
