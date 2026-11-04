import type { OutboundMediaInfo } from "../sessions/outbox.ts"

/** The largest file an agent can send (WhatsApp's own limit for photos and videos is 16 MB). */
export const MAX_SEND_BYTES = 16 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

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

/** Read a response body, refusing past `max` bytes without buffering the rest. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0)
  if (declared > max) throw new MediaInputError(`the file is ${Math.round(declared / 1024 / 1024)} MB; at most ${max / 1024 / 1024} MB can be sent`)
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => {}); throw new MediaInputError(`the file is over ${max / 1024 / 1024} MB, the most that can be sent`) }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new MediaInputError("`data` isn't valid base64")
  const bin = atob(clean.replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Turn an agent's `media` argument into the bytes to queue: downloaded from a public http(s) URL, or decoded from
 * base64. The type comes from what the agent said, else the server's content type, else the file name.
 */
export async function resolveMedia(input: MediaInput, fetchFn: typeof fetch = fetch): Promise<OutboundMediaInfo & { data: Uint8Array }> {
  if (Boolean(input.url) === Boolean(input.data)) throw new MediaInputError("give the file as exactly one of `url` or `data`")
  let data: Uint8Array
  let served: string | undefined
  let name = input.file_name
  if (input.url) {
    let url: URL
    try { url = new URL(input.url) } catch { throw new MediaInputError("`url` isn't a valid URL") }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new MediaInputError("`url` must be http(s)")
    if (isPrivateHost(url.hostname)) throw new MediaInputError("`url` must be on the public internet")
    const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => undefined)
    if (!res?.ok) throw new MediaInputError(`couldn't download the file (${res ? `HTTP ${res.status}` : "no response"})`)
    // A redirect can't land on a private address either.
    if (res.url && isPrivateHost(new URL(res.url).hostname)) throw new MediaInputError("`url` must be on the public internet")
    served = res.headers.get("content-type")?.split(";")[0]?.trim() || undefined
    data = await readCapped(res, MAX_SEND_BYTES)
    name ??= decodeURIComponent(url.pathname.split("/").pop() || "") || undefined
  } else {
    data = decodeBase64(input.data!)
    if (data.byteLength > MAX_SEND_BYTES) throw new MediaInputError(`the file is over ${MAX_SEND_BYTES / 1024 / 1024} MB, the most that can be sent`)
  }
  if (!data.byteLength) throw new MediaInputError("the file is empty")
  const generic = (t?: string) => !t || t === "application/octet-stream" || t === "binary/octet-stream"
  const mimetype = input.mimetype || (!generic(served) ? served : undefined) || fromName(name) || "application/octet-stream"
  const kind = input.kind ?? kindOf(mimetype)
  return { kind, mimetype, ...(name ? { fileName: name.slice(0, 200) } : {}), data }
}
