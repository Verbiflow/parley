import makeWASocket, {
  DisconnectReason, makeCacheableSignalKeyStore, proto, isJidGroup, isJidBroadcast, isJidNewsletter, jidNormalizedUser, normalizeMessageContent,
  type WAMessage, type Contact,
} from "@whiskeysockets/baileys"
import { proxyAgent } from "@parley/proxies/agent"
import { SendFailure, type Channel, type Chat, type InboundMessage, type LiveConnection, type OpenOptions } from "../contract.ts"
import { makeAuthState } from "./auth-state.ts"
import { WHATSAPP_ID, WHATSAPP_CAPABILITIES } from "./meta.ts"

// Baileys wants a pino-like logger; we keep it silent. Cast once, here.
const SILENT: any = { level: "silent", child: () => SILENT, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }

/** Normalize a recipient to a WhatsApp JID: a bare phone number becomes `<digits>@s.whatsapp.net`. */
function toJid(to: string): string {
  return to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@s.whatsapp.net`
}

/** Chats a person can pick: direct and group conversations. Status updates, broadcast lists and channels are not chats. */
function isChatJid(jid: string | null | undefined): jid is string {
  return Boolean(jid) && !isJidBroadcast(jid!) && !isJidNewsletter(jid!) && jid !== "status@broadcast"
}

/**
 * WhatsApp's answer to a failed send, in the host's terms. Baileys surfaces server errors as Boom errors carrying an
 * HTTP-style status: 429 is WhatsApp's rate limit, 401 a session it no longer accepts, 403 an account it has
 * restricted. Anything without a status never reached WhatsApp.
 */
function classify(error: unknown): SendFailure {
  const status = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
  const message = error instanceof Error ? error.message : String(error)
  if (status === 429 || /rate-overlimit/i.test(message)) return new SendFailure("rate_limited", message)
  if (status === 401 || status === DisconnectReason.loggedOut) return new SendFailure("auth_expired", message)
  if (status === 403) return new SendFailure("banned", message)
  if (status === 404 || status === 400) return new SendFailure("recipient_unavailable", message)
  return new SendFailure("transport_error", message)
}

const seconds = (t: unknown): string | undefined => {
  const n = Number(t ?? 0)
  return n > 0 ? new Date(n * 1000).toISOString() : undefined
}

/** The readable text of a message, or a placeholder for media/other kinds. Undefined for protocol noise (no content). */
function textOf(m: WAMessage): string | undefined {
  const c = normalizeMessageContent(m.message)
  if (!c) return undefined
  const text = c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? c.documentMessage?.caption
  if (text) return text
  if (c.imageMessage) return "[photo]"
  if (c.videoMessage) return "[video]"
  if (c.audioMessage) return "[voice message]"
  if (c.documentMessage) return `[document${c.documentMessage.fileName ? `: ${c.documentMessage.fileName}` : ""}]`
  if (c.stickerMessage) return "[sticker]"
  if (c.locationMessage) return "[location]"
  if (c.contactMessage) return "[contact card]"
  if (c.reactionMessage || c.protocolMessage || c.senderKeyDistributionMessage) return undefined
  return "[message]"
}

/**
 * The WhatsApp channel, over Baileys (unofficial WhatsApp Web multi-device). A fresh connection emits a `link` event
 * carrying the QR string; once the user scans it, `open` fires and `state` carries the creds to seal. With saved
 * state it reconnects with no QR. This is the first real `Channel` — held to the same conformance contract as the Fake
 * (via the auth-state round-trip test; the live link is validated manually, since it needs a phone).
 */
export const whatsappChannel: Channel = {
  id: WHATSAPP_ID,
  capabilities: WHATSAPP_CAPABILITIES,

  async open({ state, proxy, emit }: OpenOptions): Promise<LiveConnection> {
    // One agent for the WebSocket and one for media/HTTPS fetches, so nothing leaves from the server's own IP.
    const agent = proxy ? proxyAgent(proxy) : undefined
    const fetchAgent = proxy ? proxyAgent(proxy) : undefined
    const auth = makeAuthState(state)
    let sock!: ReturnType<typeof makeWASocket>
    let stopped = false
    // Names learned from contacts / push names, and the chats we've reported — so a name that arrives later updates them.
    const names = new Map<string, string>()
    const known = new Map<string, Chat>()
    // WhatsApp addresses a person by phone number (…@s.whatsapp.net) or by a private id (…@lid). Private ids we've
    // seen paired with a number, so a person is one chat under their number, not two (or one opaque id).
    const phoneOfLid = new Map<string, string>()
    const pair = (a?: string | null, b?: string | null) => {
      const ids = [a, b].filter((x): x is string => Boolean(x)).map(jidNormalizedUser)
      const lid = ids.find((j) => j.endsWith("@lid")), pn = ids.find((j) => j.endsWith("@s.whatsapp.net"))
      if (lid && pn) phoneOfLid.set(lid, pn)
    }
    /** The id a direct chat is kept under: its phone-number form when we know it. Groups are unchanged. */
    const canon = (jid: string): string => (jid.endsWith("@lid") ? phoneOfLid.get(jidNormalizedUser(jid)) ?? jid : jid)

    const report = (chats: Chat[]) => {
      const out: Chat[] = []
      for (const chat of chats) {
        const prev = known.get(chat.id)
        const next: Chat = {
          id: chat.id,
          kind: chat.kind,
          name: chat.name ?? names.get(chat.id) ?? prev?.name ?? null,
          lastMessageAt: [chat.lastMessageAt, prev?.lastMessageAt].filter(Boolean).sort().pop(),
        }
        if (prev && prev.name === next.name && prev.lastMessageAt === next.lastMessageAt) continue
        known.set(chat.id, next)
        out.push(next)
      }
      if (out.length) emit({ type: "chats", chats: out })
    }
    const chatOf = (jid: string, name?: string | null, at?: string): Chat => {
      const id = canon(jid)
      return { id, kind: isJidGroup(id) ? "group" : "direct", name: name || names.get(id) || names.get(jid) || null, lastMessageAt: at }
    }

    const learnContacts = (contacts: Array<Partial<Contact>>) => {
      const renamed: Chat[] = []
      for (const ct of contacts) {
        pair(ct.id, ct.lid); pair(ct.id, ct.jid); pair(ct.jid, ct.lid)
        const name = ct.name || ct.notify || ct.verifiedName
        if (!ct.id || !name) continue
        for (const id of new Set([ct.id, ct.jid, ct.lid].filter((x): x is string => Boolean(x)).map(jidNormalizedUser).map(canon))) {
          names.set(id, name)
          if (known.has(id)) renamed.push(chatOf(id, name))
        }
      }
      report(renamed)
    }

    const messageOf = (m: WAMessage): InboundMessage | undefined => {
      const raw = m.key.remoteJid
      if (!isChatJid(raw)) return undefined
      // The message itself often carries the sender's number next to their private id: learn it before keying the chat.
      const k = m.key as typeof m.key & { senderPn?: string; senderLid?: string; participantPn?: string; participantLid?: string }
      if (isJidGroup(raw)) { pair(k.participant, k.participantPn); pair(k.participant, k.participantLid) }
      else { pair(raw, k.senderPn); pair(raw, k.senderLid) }
      const jid = canon(raw)
      const text = textOf(m)
      if (text === undefined) return undefined
      const fromMe = Boolean(m.key.fromMe)
      const sender = m.key.participant ? canon(m.key.participant) : jid
      return {
        id: m.key.id ?? crypto.randomUUID(), threadId: jid, from: fromMe ? "me" : sender, text, fromMe,
        at: seconds(m.messageTimestamp) ?? new Date().toISOString(),
      }
    }
    const handleMessages = (messages: WAMessage[]) => {
      const chats: Chat[] = []
      for (const m of messages) {
        const msg = messageOf(m)
        if (!msg) continue
        // A direct chat's push name is the best name we get for people not in the address book.
        const pushName = !msg.fromMe && !isJidGroup(msg.threadId) && m.pushName && !names.has(msg.threadId) ? m.pushName : null
        chats.push(chatOf(msg.threadId, pushName, msg.at))
      }
      report(chats)
      for (const m of messages) {
        const msg = messageOf(m)
        if (msg) emit({ type: "message", message: msg })
      }
    }

    const connect = () => {
      sock = makeWASocket({
        auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, SILENT) },
        logger: SILENT,
        browser: ["Parley", "Chrome", "1.0"],
        // Don't mark the account online on connect, or the phone stops getting notifications.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // With syncFullHistory off, Baileys skips *every* history batch, including the one-time recent-chats sync
        // WhatsApp sends at link time. That's where one-to-one chats come from (groups are fetched separately), so
        // without it the list is groups only. Take the recent sync; still decline the full archive.
        shouldSyncHistoryMessage: (h) => h.syncType !== proto.Message.HistorySyncNotification.HistorySyncType.FULL,
        ...(agent ? { agent, fetchAgent } : {}),
      })

      sock.ev.on("creds.update", () => emit({ type: "state", state: auth.serialize() }))

      sock.ev.on("connection.update", (u) => {
        if (u.qr) emit({ type: "link", method: "qr", data: u.qr })
        if (u.connection === "open") {
          emit({ type: "open", handle: sock.user?.id ?? "" })
          // Group names aren't in the history sync reliably; fetch them once we're live.
          sock.groupFetchAllParticipating()
            .then((groups) => report(Object.values(groups).map((g) => chatOf(g.id, g.subject))))
            .catch(() => {})
        }
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

      sock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
        for (const c of chats) pair(c.id, (c as { pnJid?: string }).pnJid ?? (c as { lidJid?: string }).lidJid)
        learnContacts(contacts)
        // A one-to-one chat with no activity is one WhatsApp keeps for people you share a group with: not a conversation.
        report(chats.filter((c) => isChatJid(c.id))
          .map((c) => chatOf(c.id, c.name || (c as { displayName?: string }).displayName, seconds(c.conversationTimestamp ?? c.lastMessageRecvTimestamp)))
          .filter((c) => c.kind === "group" || c.lastMessageAt))
        handleMessages(messages)
      })
      // A call (either way) is as recent as a message. Only who and when; nothing is stored about the call itself.
      sock.ev.on("call", (calls) => report(calls
        .map((c) => ({ jid: c.groupJid || c.chatId || c.from, at: c.date ? new Date(c.date).toISOString() : new Date().toISOString() }))
        .filter((c) => isChatJid(c.jid))
        .map((c) => chatOf(c.jid, null, c.at))))
      sock.ev.on("chats.upsert", (chats) => report(chats.filter((c) => isChatJid(c.id)).map((c) => chatOf(c.id, c.name, seconds(c.conversationTimestamp)))))
      sock.ev.on("chats.update", (updates) => report(updates.filter((c) => isChatJid(c.id) && c.name).map((c) => chatOf(c.id!, c.name))))
      sock.ev.on("contacts.upsert", learnContacts)
      sock.ev.on("contacts.update", learnContacts)
      sock.ev.on("groups.update", (groups) => report(groups.filter((g) => g.id && g.subject).map((g) => chatOf(g.id!, g.subject))))
      sock.ev.on("messages.upsert", ({ messages }) => handleMessages(messages))
    }

    connect()

    return {
      async send(to, content) {
        const jid = toJid(to)
        // A bare number that isn't on WhatsApp is the recipient's problem, not the account's: say so before trying.
        if (jid.endsWith("@s.whatsapp.net")) {
          const [found] = await sock.onWhatsApp(jid).catch((e: unknown) => { throw classify(e) }) ?? []
          if (found && !found.exists) throw new SendFailure("recipient_unavailable", `${to} isn't on WhatsApp`)
        }
        try {
          const res = await sock.sendMessage(jid, { text: content.text })
          return { id: res?.key?.id ?? "" }
        } catch (e) {
          throw classify(e)
        }
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
