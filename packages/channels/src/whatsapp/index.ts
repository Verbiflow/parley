import makeWASocket, {
  DisconnectReason, makeCacheableSignalKeyStore, proto, ALL_WA_PATCH_NAMES, isJidGroup, isJidBroadcast, isJidNewsletter, jidNormalizedUser, normalizeMessageContent,
  type WAMessage, type Contact,
} from "@whiskeysockets/baileys"
import { proxyAgent } from "@parley/proxies/agent"
import { SendFailure, type CallKind, type Channel, type Chat, type InboundMessage, type LiveConnection, type OpenOptions } from "../contract.ts"
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
  return Boolean(jid) && !isJidBroadcast(jid!) && !isJidNewsletter(jid!) && jid !== "status@broadcast" && !isServiceNumber(jid!)
}

/** WhatsApp's own system ids (e.g. `0@s.whatsapp.net`, shown as "+0"): no real phone number is under five digits. */
function isServiceNumber(jid: string): boolean {
  return /^\d{1,4}(:\d+)?@s\.whatsapp\.net$/.test(jid)
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
    // Newly learned pairs, sent to the host in one batch per tick: a person filed under their private id before we knew
    // their number (a call log entry, say) is folded into their phone-number chat, so nobody is listed twice.
    let merges: Array<{ from: string; to: string }> = []
    const pair = (a?: string | null, b?: string | null) => {
      const ids = [a, b].filter((x): x is string => Boolean(x)).map(jidNormalizedUser)
      const lid = ids.find((j) => j.endsWith("@lid")), pn = ids.find((j) => j.endsWith("@s.whatsapp.net"))
      if (!lid || !pn || phoneOfLid.get(lid) === pn) return
      phoneOfLid.set(lid, pn)
      const old = known.get(lid)
      if (old) {
        known.delete(lid)
        const cur = known.get(pn)
        known.set(pn, { ...old, ...cur, id: pn, name: cur?.name ?? old.name,
          lastMessageAt: [old.lastMessageAt, cur?.lastMessageAt].filter(Boolean).sort().pop(),
          lastCall: !cur?.lastCall || (old.lastCall && old.lastCall.at > cur.lastCall.at) ? old.lastCall ?? cur?.lastCall : cur.lastCall })
      }
      if (!merges.length) queueMicrotask(() => { const pairs = merges; merges = []; if (pairs.length) emit({ type: "merge", pairs }) })
      merges.push({ from: lid, to: pn })
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
          lastCall: !prev?.lastCall || (chat.lastCall && chat.lastCall.at >= prev.lastCall.at) ? chat.lastCall ?? prev?.lastCall : prev.lastCall,
        }
        if (prev && prev.name === next.name && prev.lastMessageAt === next.lastMessageAt && prev.lastCall === next.lastCall) continue
        known.set(chat.id, next)
        out.push(next)
      }
      if (out.length) emit({ type: "chats", chats: out })
    }
    const chatOf = (jid: string, name?: string | null, at?: string): Chat => {
      const id = canon(jid)
      return { id, kind: isJidGroup(id) ? "group" : "direct", name: name || names.get(id) || names.get(jid) || null, lastMessageAt: at }
    }

    // Ids whose name is the one saved in the address book: someone's own WhatsApp name never replaces it.
    const saved = new Set<string>()
    /** Remember a name for these ids; returns the ids whose name changed. */
    const learnName = (ids: string[], name: string, isSaved: boolean): string[] => {
      const changed: string[] = []
      for (const id of ids) {
        if (!isSaved && saved.has(id)) continue
        if (isSaved) saved.add(id)
        if (names.get(id) !== name) { names.set(id, name); changed.push(id) }
      }
      return changed
    }
    /** Tell the host about new names, so chats it already has (from before a restart, too) get them. */
    const announceNames = (ids: string[]) => {
      const out = ids.filter((id) => !isJidGroup(id)).map((id) => ({ id, name: names.get(id)! })).filter((n) => n.name)
      for (let i = 0; i < out.length; i += 500) emit({ type: "names", names: out.slice(i, i + 500) })
    }

    const learnContacts = (contacts: Array<Partial<Contact>>) => {
      const changed: string[] = []
      for (const ct of contacts) {
        pair(ct.id, ct.lid); pair(ct.id, ct.jid); pair(ct.jid, ct.lid)
        const name = ct.name || ct.notify || ct.verifiedName
        if (!ct.id || !name) continue
        const raw = [ct.id, ct.jid, ct.lid].filter((x): x is string => Boolean(x)).map(jidNormalizedUser)
        changed.push(...learnName([...new Set([...raw, ...raw.map(canon)])], name, Boolean(ct.name)))
      }
      report(changed.filter((id) => known.has(id)).map((id) => chatOf(id, names.get(id))))
      announceNames(changed)
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

    /**
     * Address-book names live in WhatsApp's app-state sync. Baileys runs it the moment history lands, often before its
     * keys arrive, and doesn't retry, so one-to-one chats end up nameless. Run it ourselves once the link is open (and
     * once more later if that fails); it emits contacts, which name the chats. Then pair saved numbers with private ids.
     */
    const syncNames = (s: typeof sock, wait: number, triesLeft: number) => {
      setTimeout(async () => {
        if (stopped || sock !== s) return
        try { await s.resyncAppState(ALL_WA_PATCH_NAMES, true) }
        catch { if (triesLeft > 1) syncNames(s, 30_000, triesLeft - 1); return }
        await pairSavedNumbers(s)
      }, wait).unref?.()
    }
    /**
     * Some chats come only under a private id. WhatsApp answers number → private id (not the reverse), so ask it for
     * the private ids of saved numbers we can't pair yet, a few at a time, and name those private-id chats.
     */
    const pairSavedNumbers = async (s: typeof sock) => {
      const paired = new Set(phoneOfLid.values())
      const todo = [...saved].filter((j) => j.endsWith("@s.whatsapp.net") && !paired.has(j))
      const lids: string[] = []
      for (let i = 0; i < todo.length && !stopped && sock === s; i += 50) {
        try {
          for (const r of (await s.onWhatsApp(...todo.slice(i, i + 50))) ?? []) {
            const lid = (r as { lid?: string }).lid
            pair(r.jid, lid)
            const name = names.get(jidNormalizedUser(r.jid))
            if (lid && name) lids.push(...learnName([jidNormalizedUser(lid)], name, true))
          }
        } catch { break }
        await new Promise((r) => setTimeout(r, 1500))
      }
      announceNames(lids)
    }

    type CallRecord = { startTime?: number | { toNumber(): number } | null; isIncoming?: boolean | null; callResult?: number | null; callCreatorJid?: string | null; groupJid?: string | null; participants?: Array<{ userJid?: string | null }> | null }
    const mine = (jid?: string | null) => {
      const me = sock?.user, user = (j?: string | null) => j?.split(/[:@]/)[0]
      return Boolean(jid) && [me?.id, (me as { lid?: string } | undefined)?.lid].some((m) => m && user(m) === user(jid))
    }
    /** Who a call-log entry was with: the group, or the other person (the caller if it came in, else who was called). */
    const callPeer = (r: CallRecord): string | undefined => {
      if (r.groupJid) return r.groupJid
      const others = (r.participants ?? []).map((p) => p.userJid).filter((j): j is string => Boolean(j) && !mine(j))
      const creator = r.callCreatorJid && !mine(r.callCreatorJid) ? r.callCreatorJid : undefined
      const peer = r.isIncoming ? creator ?? others[0] : others[0] ?? creator
      return peer && isChatJid(peer) ? peer : undefined
    }
    const called = (jid: string, at: string, kind: CallKind): Chat => ({ ...chatOf(jid, null, at), lastCall: { at, kind } })

    /**
     * The link-time history sync arrives as a run of batches. Tell the host how far along it is (WhatsApp reports a
     * percentage on most batches), and that it's done once WhatsApp says 100% or no batch has come for 15 seconds.
     */
    let quiet: ReturnType<typeof setTimeout> | undefined
    let lastProgress: number | null = null
    const historyBatch = (progress: number | null) => {
      if (progress !== null) lastProgress = Math.max(lastProgress ?? 0, progress)
      if (quiet) clearTimeout(quiet)
      if (lastProgress !== null && lastProgress >= 100) { emit({ type: "sync", progress: 100, done: true }); return }
      emit({ type: "sync", progress: lastProgress, done: false })
      quiet = setTimeout(() => { if (!stopped) emit({ type: "sync", progress: 100, done: true }) }, 15_000)
      quiet.unref?.()
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
          syncNames(sock, 8000, 2)
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

      sock.ev.on("messaging-history.set", ({ chats, contacts, messages, progress }) => {
        historyBatch(typeof progress === "number" ? progress : null)
        for (const c of chats) pair(c.id, (c as { pnJid?: string }).pnJid ?? (c as { lidJid?: string }).lidJid)
        learnContacts(contacts)
        // Recency comes only from real messages (below) and calls. A chat's own timestamp also moves for group notices
        // (someone joined, left, changed the icon), which floats groups you never touch to the top. So: groups are listed
        // with their names; a person becomes a chat only once a real message with them turns up, and their name from
        // the chat list is kept for then. (A 1:1 with no messages is one WhatsApp keeps for people you share a group with.)
        const listed = chats.filter((c) => isChatJid(c.id))
        for (const c of listed) {
          const name = c.name || (c as { displayName?: string }).displayName
          if (name && !isJidGroup(c.id)) learnName([...new Set([jidNormalizedUser(c.id), canon(c.id)])], name, Boolean(c.name))
        }
        report(listed.filter((c) => isJidGroup(c.id)).map((c) => chatOf(c.id, c.name)))
        handleMessages(messages)
      })
      // Calls: someone you're talking to by phone is as recent as a message. Only who, when and which way; nothing about
      // the call itself. A call ringing this account now:
      sock.ev.on("call", (calls) => report(calls.flatMap((c) => {
        const jid = c.groupJid || c.chatId || c.from
        if (!isChatJid(jid)) return []
        const kind: CallKind = c.status === "timeout" || c.status === "reject" ? "missed" : "incoming"
        return [called(jid, c.date ? new Date(c.date).toISOString() : new Date().toISOString(), kind)]
      })))
      // The call log (both directions, patched in by scripts/patch-baileys.ts): the past log arrives with the
      // link-time history, then each call made or taken on any of the account's devices.
      const ev = sock.ev as unknown as { on(event: string, fn: (arg: any) => void): void }
      ev.on("call-log.set", ({ records }: { records?: CallRecord[] }) => report((records ?? []).flatMap((r) => {
        const peer = callPeer(r)
        const t = typeof r.startTime === "object" && r.startTime ? r.startTime.toNumber() : Number(r.startTime ?? 0)
        if (!peer || !(t > 0)) return []
        const kind: CallKind = !r.isIncoming ? "outgoing" : r.callResult === 0 || r.callResult === 3 ? "incoming" : "missed"
        return [called(peer, new Date(t > 1e12 ? t : t * 1000).toISOString(), kind)]
      })))
      // Private-id <-> phone-number pairs from the link-time history (patched in): how WhatsApp's own apps name people
      // it addresses by private id. Arrives before that history's messages, so those land under the phone number.
      ev.on("lid-mapping.set", ({ mappings }: { mappings?: Array<{ lidJid?: string; pnJid?: string }> }) => {
        for (const m of mappings ?? []) pair(m.lidJid, m.pnJid)
        announceNames([...phoneOfLid].filter(([, pn]) => names.has(pn)).map(([lid, pn]) => (learnName([lid], names.get(pn)!, saved.has(pn)), lid)))
      })
      // New chats: a group is listed now; a person when a real message arrives (messages.upsert). No timestamps (see above).
      sock.ev.on("chats.upsert", (chats) => report(chats.filter((c) => isChatJid(c.id) && isJidGroup(c.id)).map((c) => chatOf(c.id, c.name))))
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
