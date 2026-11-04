import makeWASocket, {
  DisconnectReason, makeCacheableSignalKeyStore, proto, ALL_WA_PATCH_NAMES, isJidGroup, isJidBroadcast, isJidNewsletter, jidNormalizedUser, downloadMediaMessage,
  type WAMessage, type WAMessageKey, type Contact, type BaileysEventMap, type AnyMessageContent,
} from "@whiskeysockets/baileys"
import { proxyAgent } from "@parley/proxies/agent"
import { SendFailure, type CallKind, type Channel, type Chat, type InboundMessage, type LiveConnection, type OpenOptions, type OutboundContent, type Reaction } from "../contract.ts"
import { makeAuthState } from "./auth-state.ts"
import { Readable } from "node:stream"
import { textOf, mediaOf, messageOfRef, reactionOf, revokedOf, embeddedReactions, mp4Seconds, type RawReaction } from "./parse.ts"
import { WHATSAPP_ID, WHATSAPP_CAPABILITIES } from "./meta.ts"

// Baileys wants a pino-like logger. Keep it quiet except errors, which go to the service log as one JSON line (Baileys'
// error objects carry ids and protocol detail, not message text).
const errorLine = (obj: unknown, msg?: string) => {
  const o = obj as { err?: unknown; error?: unknown } | undefined
  const err = o && typeof o === "object" ? o.err ?? o.error : obj
  console.error(JSON.stringify({ msg: `baileys: ${msg ?? (typeof obj === "string" ? obj : "error")}`, error: err instanceof Error ? err.message : typeof err === "string" ? err : undefined }))
}
const SILENT: any = { level: "error", child: () => SILENT, trace() {}, debug() {}, info() {}, warn() {}, error: errorLine, fatal: errorLine }

/** A Baileys event handler that can't take a history batch down with it: a throw is logged, not propagated. */
function guard(event: string, fn: (arg: any) => void): (arg: any) => void {
  return (arg) => {
    try { fn(arg) } catch (e) { console.error(JSON.stringify({ msg: "whatsapp: event handler failed", event, error: e instanceof Error ? e.stack : String(e) })) }
  }
}

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

/** A send in Baileys' terms: plain text, a file with its caption, a reaction to a stored message, or a deletion of one. */
/** 50 words a minute at ~5 characters a word: 250 characters a minute, so ~24s per 100 characters. */
const TYPING_MS_PER_CHAR = 60_000 / 250
/** Never longer than this (well inside the outbox lease), never shorter than a beat. */
export const TYPING_MAX_MS = 60_000
const TYPING_MIN_MS = 1500

/**
 * How long to show the account typing before a message: its length at 50 wpm (a voice note: as long as it plays),
 * ±15% jitter, between a beat and a minute.
 */
export function typingMs(content: Pick<OutboundContent, "text" | "media">, random = Math.random): number {
  const base = content.media?.kind === "audio" ? (content.media.seconds ?? 3) * 1000 : content.text.length * TYPING_MS_PER_CHAR
  return Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, base * (0.85 + random() * 0.3))))
}

export function contentFor(jid: string, content: OutboundContent): AnyMessageContent {
  const { text, media, react, unsend } = content
  if (unsend) {
    const key: WAMessageKey = { remoteJid: jid, id: unsend.messageId, fromMe: unsend.fromMe }
    // A group admin deleting someone else's message names whose it was.
    if (isJidGroup(jid) && !unsend.fromMe && unsend.sender) key.participant = toJid(unsend.sender)
    return { delete: key }
  }
  if (react) {
    const key: WAMessageKey = { remoteJid: jid, id: react.messageId, fromMe: react.fromMe }
    if (isJidGroup(jid) && !react.fromMe && react.sender) key.participant = toJid(react.sender)
    return { react: { text, key } }
  }
  if (!media) return { text }
  const data = Buffer.from(media.data)
  const caption = text || undefined
  switch (media.kind) {
    case "image": return { image: data, mimetype: media.mimetype, caption }
    // The length shows on the bubble; WhatsApp doesn't work it out itself.
    // (Baileys copies extra fields into the video message, it just doesn't type `seconds` for video.)
    // A GIF is a video with gifPlayback: it loops silently in the chat, as one picked from WhatsApp's GIF tab does.
    case "video": return { video: data, mimetype: media.mimetype, caption, seconds: media.seconds ?? mp4Seconds(media.data), ...(media.gif ? { gifPlayback: true } : {}) } as AnyMessageContent
    // A voice note when it's the format WhatsApp records them in; otherwise an audio file. Audio can't carry a caption.
    case "audio": return { audio: data, mimetype: media.mimetype, ptt: /ogg|opus/i.test(media.mimetype) }
    case "document": return { document: data, mimetype: media.mimetype, fileName: media.fileName ?? "file", caption }
  }
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

  async open({ state, proxy, emit, sentMessage }: OpenOptions): Promise<LiveConnection> {
    // One agent for the WebSocket and one for media/HTTPS fetches, so nothing leaves from the server's own IP.
    const agent = proxy ? proxyAgent(proxy) : undefined
    const fetchAgent = proxy ? proxyAgent(proxy) : undefined
    // Save the auth state whenever it changes: creds on `creds.update`, encryption sessions on every key write. Writes
    // come in bursts, so they're batched; a send or a close saves at once, so a restart never loads keys older than
    // the last message sent.
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const saveNow = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = undefined
      emit({ type: "state", state: auth.serialize() })
    }
    const saveSoon = () => {
      if (saveTimer || stopped) return
      saveTimer = setTimeout(saveNow, 1000)
      saveTimer.unref?.()
    }
    const auth = makeAuthState(state, saveSoon)
    let sock!: ReturnType<typeof makeWASocket>
    let stopped = false
    // Messages we sent, by id. When a recipient's phone can't decrypt one, it asks us to send it again; Baileys looks
    // the message up through `getMessage` and re-encrypts it. Without this the request is ignored and the recipient sees
    // "Waiting for this message" for good. Recent ones are kept here (across reconnects); every one also goes to the
    // host to store, so a request that comes after a restart (a deploy) still finds it.
    const sent = new Map<string, proto.IMessage>()
    const SENT_CAP = 1000
    const remember = (id: string | null | undefined, message: proto.IMessage | null | undefined) => {
      if (!id || !message) return
      sent.delete(id)
      sent.set(id, message)
      if (sent.size > SENT_CAP) sent.delete(sent.keys().next().value!)
      emit({ type: "sent", id, message: proto.Message.encode(message).finish() })
    }
    const lookUpSent = async (id: string): Promise<{ message?: proto.IMessage; from: "memory" | "store" | "none" }> => {
      const recent = sent.get(id)
      if (recent) return { message: recent, from: "memory" }
      const stored = await sentMessage?.(id).catch(() => undefined)
      return stored ? { message: proto.Message.decode(stored), from: "store" } : { from: "none" }
    }
    // How many times each message has been resent, so a phone that keeps failing can't make us resend forever. Shared
    // across reconnects (Baileys would otherwise start a fresh count on every socket).
    const retries = new Map<string, unknown>()
    const msgRetryCounterCache = {
      get: <T,>(k: string) => retries.get(k) as T | undefined,
      set: <T,>(k: string, v: T) => { retries.set(k, v); if (retries.size > SENT_CAP) retries.delete(retries.keys().next().value!) },
      del: (k: string) => { retries.delete(k) },
      flushAll: () => retries.clear(),
    }
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
        pair(ct.id, ct.lid); pair(ct.id, ct.phoneNumber); pair(ct.phoneNumber, ct.lid)
        const name = ct.name || ct.notify || ct.verifiedName
        if (!ct.id || !name) continue
        const raw = [ct.id, ct.phoneNumber, ct.lid].filter((x): x is string => Boolean(x)).map(jidNormalizedUser)
        changed.push(...learnName([...new Set([...raw, ...raw.map(canon)])], name, Boolean(ct.name)))
      }
      report(changed.filter((id) => known.has(id)).map((id) => chatOf(id, names.get(id))))
      announceNames(changed)
    }

    const messageOf = (m: WAMessage): InboundMessage | undefined => {
      const raw = m.key.remoteJid
      if (!isChatJid(raw)) return undefined
      // The message itself often carries the sender's number next to their private id: learn it before keying the chat.
      const k = m.key
      if (isJidGroup(raw)) pair(k.participant, k.participantAlt)
      else pair(raw, k.remoteJidAlt)
      const jid = canon(raw)
      const text = textOf(m)
      if (text === undefined) return undefined
      const fromMe = Boolean(m.key.fromMe)
      const sender = m.key.participant ? canon(m.key.participant) : jid
      const media = mediaOf(m)
      const reactions = embeddedReactions(m).map((r) => reactionIn(jid, r))
      return {
        id: m.key.id ?? crypto.randomUUID(), threadId: jid, from: fromMe ? "me" : sender, text, fromMe,
        at: seconds(m.messageTimestamp) ?? new Date().toISOString(),
        ...(media ? { media } : {}), ...(reactions.length ? { reactions } : {}),
      }
    }
    /** A reaction in chat `jid`, in the host's terms: who reacted is "me", the group member, or the other person. */
    const reactionIn = (jid: string, r: RawReaction): Reaction => {
      const k: WAMessageKey = r.reactor
      if (k.participant) pair(k.participant, k.participantAlt)
      const fromMe = Boolean(k.fromMe)
      return {
        threadId: jid, messageId: r.target, fromMe, emoji: r.emoji,
        from: fromMe ? "me" : k.participant ? canon(k.participant) : jid,
        at: r.atMs > 0 ? new Date(r.atMs).toISOString() : new Date().toISOString(),
      }
    }
    /** A live reaction message: not a message of its own, but a change to the one it points at. */
    const reactionMessageOf = (m: WAMessage): Reaction | undefined => {
      const raw = m.key.remoteJid
      if (!isChatJid(raw)) return undefined
      const r = reactionOf(m)
      if (!r) return undefined
      if (!isJidGroup(raw)) pair(raw, m.key.remoteJidAlt)
      return reactionIn(canon(raw), r)
    }
    /**
     * What the phone says back to our requests (history on demand, resends of messages that failed to decrypt). Baileys
     * acts on some answers and drops the rest silently; this logs every one, by type and counts only, never content.
     */
    const traceProtocol = (m: WAMessage) => {
      const p = m.message?.protocolMessage
      if (!p || !m.key.fromMe) return
      if (p.type === proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION) {
        const h = p.historySyncNotification
        console.log(JSON.stringify({ msg: "whatsapp: history notification", syncType: h?.syncType, chunkOrder: h?.chunkOrder, requestId: h?.peerDataRequestSessionId || undefined, inline: Boolean(h?.initialHistBootstrapInlinePayload?.length) }))
      } else if (p.type === proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE) {
        const r = p.peerDataOperationRequestResponseMessage
        const results = r?.peerDataOperationResult ?? []
        console.log(JSON.stringify({
          msg: "whatsapp: phone answered a request", requestType: r?.peerDataOperationRequestType, requestId: r?.stanzaId, results: results.length,
          kinds: [...new Set(results.flatMap((x) => Object.keys(x ?? {}).filter((k) => (x as Record<string, unknown>)[k] != null)))],
          codes: [...new Set(results.map((x) => x?.mediaUploadResult).filter((c) => c != null))],
        }))
      }
    }
    /** A "delete for everyone" (by the other person, or by the account from any of its devices): which message it took back. */
    const deletionOf = (m: WAMessage): { threadId: string; messageId: string } | undefined => {
      const raw = m.key.remoteJid
      const target = revokedOf(m)
      if (!target || !isChatJid(raw)) return undefined
      if (!isJidGroup(raw)) pair(raw, m.key.remoteJidAlt)
      return { threadId: canon(raw), messageId: target }
    }
    /** `live`: they just happened (messages.upsert), not history (the link-time sync, a backfill). */
    const handleMessages = (messages: WAMessage[], live: boolean) => {
      for (const m of messages) traceProtocol(m)
      const reactions = messages.map(reactionMessageOf).filter((r): r is Reaction => Boolean(r))
      const deleted = messages.map(deletionOf).filter((d): d is { threadId: string; messageId: string } => Boolean(d))
      const chats: Chat[] = []
      for (const m of messages) {
        const msg = messageOf(m)
        if (!msg) continue
        // A direct chat's push name is the best name we get for people not in the address book.
        const pushName = !msg.fromMe && !isJidGroup(msg.threadId) && m.pushName && !names.has(msg.threadId) ? m.pushName : null
        chats.push(chatOf(msg.threadId, pushName, msg.at))
      }
      report(chats)
      const out = messages.map(messageOf).filter((m): m is InboundMessage => Boolean(m))
      // History arrives in batches of thousands: hand them over in chunks the host stores in one write each.
      if (out.length === 1) emit({ type: "message", message: out[0]!, live })
      else for (let i = 0; i < out.length; i += 500) emit({ type: "messages", messages: out.slice(i, i + 500), live })
      // After the messages, so a reaction that came in the same batch as its message finds it stored.
      if (reactions.length) emit({ type: "reactions", reactions, live })
      if (deleted.length) emit({ type: "deleted", messages: deleted, live })
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
          for (const r of (await s.signalRepository.lidMapping.getLIDsForPNs(todo.slice(i, i + 50))) ?? []) {
            pair(r.pn, r.lid)
            const name = names.get(jidNormalizedUser(r.pn))
            if (r.lid && name) lids.push(...learnName([jidNormalizedUser(r.lid)], name, true))
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
     * Private-id <-> phone-number pairs: how WhatsApp's own apps show a number and name for people it addresses by
     * private id. Pair them, then give each private id the name we already have for its number.
     */
    const learnPairs = (mappings: Array<{ lid?: string | null; pn?: string | null }>) => {
      if (!mappings.length) return
      for (const m of mappings) pair(m.lid, m.pn)
      announceNames([...phoneOfLid].filter(([, pn]) => names.has(pn)).map(([lid, pn]) => (learnName([lid], names.get(pn)!, saved.has(pn)), lid)))
    }

    /**
     * The link-time history sync arrives as a run of batches of different kinds. Each kind reports its own percentage
     * (the tiny first bootstrap batch says 100% by itself), so the progress shown is the recent-chats batches' — what
     * the person is waiting for — and "done" means no batch has come for 15 seconds, never a single batch's 100%.
     */
    let quiet: ReturnType<typeof setTimeout> | undefined
    let lastProgress: number | null = null
    const historyBatch = (progress: number | null, syncType: number | null | undefined) => {
      if (progress !== null && syncType === proto.HistorySync.HistorySyncType.RECENT) lastProgress = Math.max(lastProgress ?? 0, progress)
      if (quiet) clearTimeout(quiet)
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
        shouldSyncHistoryMessage: (h) => h.syncType !== proto.Message.HistorySyncType.FULL,
        // Resend a message a recipient couldn't decrypt (see `sent` above).
        // Logged (ids only, no text) so a message stuck on "Waiting for this message" can be traced.
        getMessage: async (key) => {
          const found = key.id ? await lookUpSent(key.id) : { from: "none" as const }
          console.log(JSON.stringify({ msg: "whatsapp: resend requested", id: key.id, found: Boolean(found.message), from: found.from }))
          return found.message
        },
        msgRetryCounterCache,
        ...(agent ? { agent, fetchAgent } : {}),
      })

      // Every handler goes through guard(). Typed by Baileys' events; the patched-in one (call-log.set) isn't in its
      // map, so it gets the plain overload.
      function on<K extends keyof BaileysEventMap>(event: K, fn: (arg: BaileysEventMap[K]) => void): void
      function on(event: "call-log.set", fn: (arg: any) => void): void
      function on(event: string, fn: (arg: any) => void): void {
        (sock.ev as unknown as { on(e: string, f: (a: any) => void): void }).on(event, guard(event, fn))
      }
      on("creds.update", saveNow)

      on("connection.update", (u) => {
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

      on("messaging-history.set", ({ chats, contacts, messages, progress, syncType, lidPnMappings }) => {
        // Sizes only (no names or text), so a sync that stalls shows up in the service log.
        console.log(JSON.stringify({ msg: "whatsapp: history batch", syncType, progress, chats: chats?.length ?? 0, contacts: contacts?.length ?? 0, messages: messages?.length ?? 0 }))
        // Private-id <-> phone-number pairs first, so this batch's messages land under the phone number.
        learnPairs(lidPnMappings ?? [])
        for (const c of chats) pair(c.id, c.pnJid ?? c.lidJid)
        learnContacts(contacts)
        // Recency comes only from real messages (below) and calls. A chat's own timestamp also moves for group notices
        // (someone joined, left, changed the icon), which floats groups you never touch to the top. So: groups are listed
        // with their names; a person becomes a chat only once a real message with them turns up, and their name from
        // the chat list is kept for then. (A 1:1 with no messages is one WhatsApp keeps for people you share a group with.)
        const listed = chats.filter((c): c is typeof c & { id: string } => isChatJid(c.id))
        for (const c of listed) {
          const name = c.name || (c as { displayName?: string }).displayName
          if (name && !isJidGroup(c.id)) learnName([...new Set([jidNormalizedUser(c.id), canon(c.id)])], name, Boolean(c.name))
        }
        report(listed.filter((c) => isJidGroup(c.id)).map((c) => chatOf(c.id, c.name)))
        handleMessages(messages, false)
        // After the batch's chats and messages, so the host has stored them before it hears the progress (or "done").
        // History we asked for (a backfill) isn't the link-time sync: it mustn't show "Syncing" again.
        if (syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) historyBatch(typeof progress === "number" ? progress : null, syncType)
      })
      // Calls: someone you're talking to by phone is as recent as a message. Only who, when and which way; nothing about
      // the call itself. A call ringing this account now:
      on("call", (calls) => report(calls.flatMap((c) => {
        const jid = c.groupJid || c.chatId || c.from
        if (!isChatJid(jid)) return []
        const kind: CallKind = c.status === "timeout" || c.status === "reject" ? "missed" : "incoming"
        return [called(jid, c.date ? new Date(c.date).toISOString() : new Date().toISOString(), kind)]
      })))
      // The call log (both directions, patched in by scripts/patch-baileys.ts): the past log arrives with the
      // link-time history, then each call made or taken on any of the account's devices.
      on("call-log.set", ({ records }: { records?: CallRecord[] }) => report((records ?? []).flatMap((r) => {
        const peer = callPeer(r)
        const t = typeof r.startTime === "object" && r.startTime ? r.startTime.toNumber() : Number(r.startTime ?? 0)
        if (!peer || !(t > 0)) return []
        const kind: CallKind = !r.isIncoming ? "outgoing" : r.callResult === 0 || r.callResult === 3 ? "incoming" : "missed"
        return [called(peer, new Date(t > 1e12 ? t : t * 1000).toISOString(), kind)]
      })))
      // A private-id <-> phone-number pair learned live (from a message, a receipt, a lookup).
      on("lid-mapping.update", (m) => learnPairs([m]))
      // New chats: a group is listed now; a person when a real message arrives (messages.upsert). No timestamps (see above).
      on("chats.upsert", (chats) => report(chats.filter((c): c is typeof c & { id: string } => isChatJid(c.id) && Boolean(isJidGroup(c.id))).map((c) => chatOf(c.id, c.name))))
      on("chats.update", (updates) => report(updates.filter((c) => isChatJid(c.id) && c.name).map((c) => chatOf(c.id!, c.name))))
      on("contacts.upsert", learnContacts)
      on("contacts.update", learnContacts)
      on("groups.update", (groups) => report(groups.filter((g) => g.id && g.subject).map((g) => chatOf(g.id!, g.subject))))
      on("messages.upsert", ({ messages }) => handleMessages(messages, true))
    }

    connect()

    /**
     * "typing…" (or "recording…" before a voice note) for about as long as a person would take, then cleared. Best
     * effort: if WhatsApp won't take the indicator, the message still goes.
     */
    async function showTyping(jid: string, content: OutboundContent): Promise<void> {
      const state = content.media?.kind === "audio" ? "recording" : "composing"
      const ms = typingMs(content)
      try {
        console.log(JSON.stringify({ msg: "whatsapp: typing", state, ms, chars: content.text.length }))
        // The indicator fades after ~10s on the other phone: say it again every 8s until the message goes.
        for (let left = ms; left > 0; left -= 8000) {
          await sock.sendPresenceUpdate(state, jid)
          await new Promise((r) => setTimeout(r, Math.min(left, 8000)))
        }
        await sock.sendPresenceUpdate("paused", jid)
      } catch (e) {
        console.error(JSON.stringify({ msg: "whatsapp: typing failed", state, error: e instanceof Error ? e.message : String(e) }))
      }
    }

    return {
      async send(to, content) {
        const jid = toJid(to)
        // A bare number that isn't on WhatsApp is the recipient's problem, not the account's: say so before trying.
        if (jid.endsWith("@s.whatsapp.net")) {
          const [found] = await sock.onWhatsApp(jid).catch((e: unknown) => { throw classify(e) }) ?? []
          if (found && !found.exists) throw new SendFailure("recipient_unavailable", `${to} isn't on WhatsApp`)
        }
        try {
          if (content.typing && !content.react && !content.unsend) await showTyping(jid, content)
          const res = await sock.sendMessage(jid, contentFor(jid, content))
          remember(res?.key?.id, res?.message)
          return { id: res?.key?.id ?? "" }
        } catch (e) {
          throw classify(e)
        } finally {
          // Sending moved the encryption sessions forward; save them before anything can restart us.
          if (saveTimer) saveNow()
        }
      },
      async media(ref) {
        const message = messageOfRef(ref)
        // WhatsApp keeps media for a while; once its copy is gone, Baileys asks the sender's phone to upload it again.
        const stream = await downloadMediaMessage(message, "stream", {}, { logger: SILENT, reuploadRequest: (m) => sock.updateMediaMessage(m) })
        const c = message.message ?? {}
        const mimetype = (c.imageMessage ?? c.videoMessage ?? c.ptvMessage ?? c.audioMessage ?? c.documentMessage ?? c.stickerMessage)?.mimetype ?? "application/octet-stream"
        return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, mimetype }
      },
      async backfill(anchor, count) {
        // The phone answers with a history batch of the messages before this one (as WhatsApp Desktop does when you
        // scroll up). It has to be online; the answer comes through messaging-history.set like any history.
        const jid = toJid(anchor.threadId)
        // The phone files a person's chat under their private id or their number, depending on the chat: ask under
        // each form we know (an answer to both is harmless; stored messages are only filled in).
        const lids = isJidGroup(jid) ? [] : [...phoneOfLid].filter(([, pn]) => pn === jid).map(([lid]) => lid)
        for (const remoteJid of [...lids, jid]) {
          const key: WAMessageKey = { remoteJid, id: anchor.messageId, fromMe: anchor.fromMe }
          if (isJidGroup(jid) && !anchor.fromMe && anchor.sender && anchor.sender !== "me") key.participant = toJid(anchor.sender)
          const requestId = await sock.fetchMessageHistory(Math.max(1, Math.min(50, count)), key, Date.parse(anchor.at))
          console.log(JSON.stringify({ msg: "whatsapp: history requested", requestId, addressing: remoteJid.endsWith("@lid") ? "lid" : isJidGroup(remoteJid) ? "group" : "pn", count }))
        }
      },
      async markRead(messages) {
        // As opening the chat on the phone does. Baileys checks the account's own privacy setting first: with read
        // receipts off it sends "read-self", which only marks the chat read on the account's own devices.
        const keys: WAMessageKey[] = []
        for (const m of messages) {
          const jid = toJid(m.threadId)
          // A person's messages may have come in under their private id or their number: mark under each form we
          // know (a receipt for a message that isn't under that address is ignored).
          const lids = isJidGroup(jid) ? [] : [...phoneOfLid].filter(([, pn]) => pn === jid).map(([lid]) => lid)
          for (const remoteJid of [...lids, jid]) {
            const key: WAMessageKey = { remoteJid, id: m.messageId, fromMe: false }
            if (isJidGroup(jid) && m.sender && m.sender !== "me") key.participant = toJid(m.sender)
            keys.push(key)
          }
        }
        if (!keys.length) return
        await sock.readMessages(keys)
        console.log(JSON.stringify({ msg: "whatsapp: marked read", messages: messages.length }))
      },
      async logout() {
        stopped = true
        if (saveTimer) clearTimeout(saveTimer)
        await sock.logout().catch(() => {})
      },
      async close() {
        stopped = true
        if (saveTimer) saveNow()
        sock.end(undefined)
      },
    }
  },
}
