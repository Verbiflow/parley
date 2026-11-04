import { proto, normalizeMessageContent, type WAMessage, type WAMessageKey } from "@whiskeysockets/baileys"
import type { MediaInfo, MediaKind } from "../contract.ts"

/** A protobuf number field: a plain number, or a Long from a decoded message. */
export const num = (x: unknown): number => {
  if (x && typeof x === "object" && "toNumber" in x) return (x as { toNumber(): number }).toNumber()
  const n = Number(x ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** The readable text of a message, or a placeholder for media/other kinds. Undefined for protocol noise (no content). */
export function textOf(m: WAMessage): string | undefined {
  const c = normalizeMessageContent(m.message)
  if (!c) return undefined
  const text = c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? c.documentMessage?.caption
  if (text) return text
  if (c.imageMessage) return "[photo]"
  if (c.videoMessage || c.ptvMessage) return "[video]"
  if (c.audioMessage) return c.audioMessage.ptt ? "[voice message]" : "[audio]"
  if (c.documentMessage) return `[document${c.documentMessage.fileName ? `: ${c.documentMessage.fileName}` : ""}]`
  if (c.stickerMessage) return "[sticker]"
  if (c.locationMessage) return "[location]"
  if (c.contactMessage) return "[contact card]"
  if (c.reactionMessage || c.protocolMessage || c.senderKeyDistributionMessage) return undefined
  return "[message]"
}

/** The media fields of a message kind, and what we call it. A round video note (`ptvMessage`) is a video. */
const MEDIA_FIELDS: Array<[keyof proto.IMessage, MediaKind]> = [
  ["imageMessage", "image"], ["videoMessage", "video"], ["ptvMessage", "video"], ["audioMessage", "audio"],
  ["documentMessage", "document"], ["stickerMessage", "sticker"],
]

type MediaFields = {
  url?: string | null; directPath?: string | null; mediaKey?: Uint8Array | null; mimetype?: string | null
  fileEncSha256?: Uint8Array | null; fileSha256?: Uint8Array | null; fileLength?: unknown; mediaKeyTimestamp?: unknown
  fileName?: string | null; width?: number | null; height?: number | null; seconds?: number | null
}

/**
 * The attachment a message carries, with a `ref` that can fetch it later: the message key (needed to ask the sender's
 * phone to upload it again once WhatsApp's copy has expired) and just the fields needed to download and decrypt it —
 * no thumbnail, no caption. Undefined for a message without media, or media that can't be downloaded (no key).
 */
export function mediaOf(m: WAMessage): MediaInfo | undefined {
  const c = normalizeMessageContent(m.message)
  if (!c) return undefined
  for (const [field, kind] of MEDIA_FIELDS) {
    const media = c[field] as MediaFields | null | undefined
    if (!media) continue
    if (!media.mediaKey?.length || !(media.directPath || media.url)) return undefined
    const slim: MediaFields = {
      url: media.url, directPath: media.directPath, mediaKey: media.mediaKey, mimetype: media.mimetype,
      fileEncSha256: media.fileEncSha256, fileSha256: media.fileSha256, fileLength: media.fileLength, mediaKeyTimestamp: media.mediaKeyTimestamp,
    }
    const message = Buffer.from(proto.Message.encode({ [field]: slim } as proto.IMessage).finish()).toString("base64")
    const key: WAMessageKey = { remoteJid: m.key.remoteJid, id: m.key.id, fromMe: m.key.fromMe, participant: m.key.participant }
    return {
      kind, mimetype: media.mimetype ?? null, fileName: media.fileName ?? null, size: num(media.fileLength) || null,
      width: media.width ?? null, height: media.height ?? null, seconds: media.seconds ?? null,
      ref: JSON.stringify({ v: 1, key, message }),
    }
  }
  return undefined
}

/** The message a `MediaInfo.ref` stands for, ready for Baileys' `downloadMediaMessage`. */
export function messageOfRef(ref: string): WAMessage {
  const parsed = JSON.parse(ref) as { v?: number; key?: WAMessageKey; message?: string }
  if (parsed.v !== 1 || !parsed.key || typeof parsed.message !== "string") throw new Error("not a WhatsApp media ref")
  return { key: parsed.key, message: proto.Message.decode(Buffer.from(parsed.message, "base64")) }
}

/** A reaction in WhatsApp's terms: who reacted (their reaction message's key), to what, with what, when. */
export type RawReaction = { reactor: WAMessageKey; target: string; emoji: string; atMs: number }

/** A live reaction message: someone (or the account) reacted to `reactionMessage.key`. */
export function reactionOf(m: WAMessage): RawReaction | undefined {
  const r = normalizeMessageContent(m.message)?.reactionMessage
  if (!r?.key?.id) return undefined
  return { reactor: m.key, target: r.key.id, emoji: r.text ?? "", atMs: num(r.senderTimestampMs) || num(m.messageTimestamp) * 1000 }
}

/** The reactions a history message already had (history carries them on the message, not as messages of their own). */
export function embeddedReactions(m: WAMessage): RawReaction[] {
  if (!m.key.id) return []
  return (m.reactions ?? []).flatMap((r) => (r.key ? [{ reactor: r.key, target: m.key.id!, emoji: r.text ?? "", atMs: num(r.senderTimestampMs) }] : []))
}
