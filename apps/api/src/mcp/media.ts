import type { OutboundMediaInfo } from "../sessions/outbox.ts"

/** The largest photo, and the largest file sent inline as base64. */
export const MAX_SEND_BYTES = 16 * 1024 * 1024
/** The largest video, audio file or document (downloaded from a URL by the sessions service). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

export class MediaInputError extends Error {}

export type MediaInput = { url?: string | undefined; data?: string | undefined; kind?: OutboundMediaInfo["kind"] | undefined; mimetype?: string | undefined; file_name?: string | undefined }

/** What kind of message a file makes, from its type: photos and videos show inline, anything else goes as a document. */
export function kindOf(mimetype: string): OutboundMediaInfo["kind"] {
  if (/^image\/(jpeg|png|webp)$/i.test(mimetype)) return "image"
  if (/^video\/(mp4|3gpp|quicktime)$/i.test(mimetype)) return "video"
  if (/^audio\//i.test(mimetype)) return "audio"
  return "document"
}

const EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime",
  "3gp": "video/3gpp", ogg: "audio/ogg; codecs=opus", opus: "audio/ogg; codecs=opus", mp3: "audio/mpeg", m4a: "audio/mp4", pdf: "application/pdf",
}
const fromName = (name: string | undefined) => (name ? EXT[name.split(".").pop()!.toLowerCase()] : undefined)

/**
 * A literal address that isn't on the public internet: loopback, private ranges, link-local (cloud metadata
 * endpoints live there), and the like. Names are resolved by the platform's fetch; this stops the obvious cases.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase()
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (h.includes(":")) return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:")
  return false
}

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new MediaInputError("`data` isn't valid base64")
  const bin = atob(clean.replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The most a file of this kind may be. Photos are WhatsApp's 16 MB; videos, audio and documents go up to 100 MB here. */
export const maxBytesFor = (kind: OutboundMediaInfo["kind"] | undefined): number => (kind === "image" ? MAX_SEND_BYTES : MAX_FILE_BYTES)

/**
 * What a file is, from what the agent said, else what its server said, else its name; and how it shows in the chat.
 * Checks it isn't empty or too big for its kind.
 */
export function describeMedia(f: { data: Uint8Array; kind?: OutboundMediaInfo["kind"] | undefined; mimetype?: string | undefined; served?: string | undefined; fileName?: string | undefined }): OutboundMediaInfo & { data: Uint8Array } {
  if (!f.data.byteLength) throw new MediaInputError("the file is empty")
  const generic = (t?: string) => !t || t === "application/octet-stream" || t === "binary/octet-stream"
  const mimetype = f.mimetype || (!generic(f.served) ? f.served : undefined) || fromName(f.fileName) || "application/octet-stream"
  const kind = f.kind ?? kindOf(mimetype)
  const max = maxBytesFor(kind)
  if (f.data.byteLength > max) throw new MediaInputError(`a ${kind} can be at most ${max / 1024 / 1024} MB (this one is ${Math.ceil(f.data.byteLength / 1024 / 1024)} MB)`)
  return { kind, mimetype, ...(f.fileName ? { fileName: f.fileName.slice(0, 200) } : {}), data: f.data }
}

/** A file to send, as it travels to the sessions service: the bytes already, or a URL it downloads itself. */
export type MediaSend = (OutboundMediaInfo & { data: Uint8Array }) | { url: string; kind?: OutboundMediaInfo["kind"] | undefined; mimetype?: string | undefined; fileName?: string | undefined }

/**
 * Turn an agent's `media` argument into what to queue. Base64 is decoded here. A URL is only checked (http(s), not an
 * obviously private host): the sessions service downloads it, re-checking every address it resolves to, so large
 * files never pass through the edge.
 */
export function resolveMedia(input: MediaInput): MediaSend {
  if (Boolean(input.url) === Boolean(input.data)) throw new MediaInputError("give the file as exactly one of `url` or `data`")
  if (input.url) {
    let url: URL
    try { url = new URL(input.url) } catch { throw new MediaInputError("`url` isn't a valid URL") }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new MediaInputError("`url` must be http(s)")
    if (isPrivateHost(url.hostname)) throw new MediaInputError("`url` must be on the public internet")
    return { url: url.href, kind: input.kind, mimetype: input.mimetype, fileName: input.file_name }
  }
  const data = decodeBase64(input.data!)
  if (data.byteLength > MAX_SEND_BYTES) throw new MediaInputError(`files sent as \`data\` can be at most ${MAX_SEND_BYTES / 1024 / 1024} MB; pass a \`url\` for bigger ones`)
  return describeMedia({ data, kind: input.kind, mimetype: input.mimetype, fileName: input.file_name })
}
