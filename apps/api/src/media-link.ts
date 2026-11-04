/**
 * Download links for message attachments (`/media/<token>`), so an agent can fetch a video or document of any size
 * with plain HTTP — from a sandbox, a script, `curl`. The token is signed (HMAC-SHA256 under a key derived from the
 * sign-in key) and names exactly one message for one account, for a short while. Edge-safe: WebCrypto only.
 */

/** How long a link works. Long enough to hand to a tool; short enough that a leaked one soon goes dead. */
export const MEDIA_LINK_SECONDS = 60 * 60

export type MediaLinkClaims = { accountId: string; connectionId: string; chatId: string; messageId: string; expiresAt: number }

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>
const keys = new Map<string, Promise<Key>>()
function keyFor(secret: string): Promise<Key> {
  let k = keys.get(secret)
  if (!k) {
    // Its own key, so a link can never be confused with anything else signed under the sign-in key.
    k = crypto.subtle.digest("SHA-256", enc.encode(`parley media links\0${secret}`))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]))
    keys.set(secret, k)
  }
  return k
}

export async function signMediaLink(secret: string, claims: Omit<MediaLinkClaims, "expiresAt">, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = Math.floor(now / 1000) + MEDIA_LINK_SECONDS
  const body = b64url(enc.encode(JSON.stringify({ a: claims.accountId, c: claims.connectionId, t: claims.chatId, m: claims.messageId, e: expiresAt })))
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await keyFor(secret), enc.encode(body)))
  return { token: `${body}.${b64url(sig)}`, expiresAt: new Date(expiresAt * 1000).toISOString() }
}

/** The claims of a valid, unexpired link; undefined for anything else. */
export async function verifyMediaLink(secret: string, token: string, now = Date.now()): Promise<MediaLinkClaims | undefined> {
  const [body, sig, extra] = token.split(".")
  if (!body || !sig || extra !== undefined) return undefined
  try {
    if (!(await crypto.subtle.verify("HMAC", await keyFor(secret), fromB64url(sig), enc.encode(body)))) return undefined
    const c = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { a?: string; c?: string; t?: string; m?: string; e?: number }
    if (!c.a || !c.c || !c.t || !c.m || typeof c.e !== "number" || c.e * 1000 < now) return undefined
    return { accountId: c.a, connectionId: c.c, chatId: c.t, messageId: c.m, expiresAt: c.e }
  } catch {
    return undefined
  }
}
