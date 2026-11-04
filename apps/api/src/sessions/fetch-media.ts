import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { isPrivateHost, MediaInputError } from "../mcp/media.ts"

const TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5

/** A file fetched for sending: the bytes, and what the server said they are. */
export type Fetched = { data: Uint8Array; contentType?: string | undefined; fileName?: string | undefined }
export type MediaFetcher = (url: string, maxBytes: number) => Promise<Fetched>

type Lookup = (host: string, options: { all?: boolean }, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => void

/**
 * A `lookup` for http(s) requests that resolves a host and refuses it (with `refuse()`'s error) if any address it
 * resolves to is private, loopback or link-local. The socket then connects to exactly the address checked, so a name
 * can't resolve to something public here and private there.
 */
export function publicOnlyLookup(refuse: () => Error): Lookup {
  return (host, options, cb) => {
    dnsLookup(host, { all: true }, (err, addresses) => {
      if (err) return cb(err, "")
      const list = addresses as LookupAddress[]
      if (!list.length || list.some((a) => isPrivateHost(a.address))) return cb(refuse(), "")
      if (options.all) cb(null, list)
      else cb(null, list[0]!.address, list[0]!.family)
    })
  }
}

const safeLookup = publicOnlyLookup(() => new MediaInputError("`url` must be on the public internet"))

function get(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest
    const req = request(url, { method: "GET", lookup: safeLookup as never, timeout: TIMEOUT_MS, headers: { "user-agent": "Parley/1.0 (+https://itsparley.com)", accept: "*/*" } }, resolve)
    req.on("timeout", () => req.destroy(new MediaInputError("the download timed out")))
    req.on("error", reject)
    req.end()
  })
}

/**
 * Download a file from a public http(s) URL, at most `maxBytes`, following a few redirects (each re-checked). Runs on
 * the sessions service, so large files never pass through the edge.
 */
export const fetchPublicMedia: MediaFetcher = async (raw, maxBytes) => {
  let url: URL
  try { url = new URL(raw) } catch { throw new MediaInputError("`url` isn't a valid URL") }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new MediaInputError("`url` must be http(s)")
    // IP literals skip the lookup, so check them here.
    if (isPrivateHost(url.hostname)) throw new MediaInputError("`url` must be on the public internet")
    let res: IncomingMessage
    try { res = await get(url) } catch (e) { throw e instanceof MediaInputError ? e : new MediaInputError(`couldn't download the file (${(e as Error).message})`) }
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      if (hop >= MAX_REDIRECTS) throw new MediaInputError("too many redirects")
      url = new URL(res.headers.location, url)
      continue
    }
    if (status < 200 || status >= 300) { res.resume(); throw new MediaInputError(`couldn't download the file (HTTP ${status})`) }
    const declared = Number(res.headers["content-length"] ?? 0)
    if (declared > maxBytes) { res.destroy(); throw new MediaInputError(`the file is ${Math.round(declared / 1024 / 1024)} MB; at most ${Math.round(maxBytes / 1024 / 1024)} MB can be sent`) }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > maxBytes) { res.destroy(); throw new MediaInputError(`the file is over ${Math.round(maxBytes / 1024 / 1024)} MB, the most that can be sent`) }
      chunks.push(chunk)
    }
    const disposition = String(res.headers["content-disposition"] ?? "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]
    const fileName = (disposition ? decodeURIComponent(disposition) : decodeURIComponent(url.pathname.split("/").pop() || "")) || undefined
    return { data: new Uint8Array(Buffer.concat(chunks)), contentType: res.headers["content-type"]?.split(";")[0]?.trim() || undefined, fileName }
  }
}
