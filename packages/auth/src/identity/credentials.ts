const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

/** A secret with a prefix that says what it is, so one found in a log or a paste is recognised at once. */
export function newSecret(prefix: "parley_dc" | "parley_sc" | "parley_dvc" | "parley_bs" | "parley_pt"): string {
  return `${prefix}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`
}

/** What's stored instead of a secret: a lookup key that can't be turned back into it. */
export async function hashSecret(secret: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret))))
}

/** RFC 7636's S256: the challenge is the verifier's SHA-256, base64url-encoded. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  return (await hashSecret(verifier)) === challenge
}

// RFC 8628 §6.1: consonants only, so a code can't spell a word, and none that are easily confused.
const USER_CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ"

/** Eight letters as `XXXX-XXXX`: about 2^34 codes, typed on another screen within minutes. */
export function newUserCode(): string {
  const letters: string[] = []
  const unbiased = 256 - (256 % USER_CODE_LETTERS.length)
  while (letters.length < 8)
    for (const byte of crypto.getRandomValues(new Uint8Array(16)))
      if (byte < unbiased && letters.length < 8) letters.push(USER_CODE_LETTERS.charAt(byte % USER_CODE_LETTERS.length))
  return `${letters.slice(0, 4).join("")}-${letters.slice(4).join("")}`
}

/** Accepts what people type: any case, spaces or no dash. Undefined when it can't be a code. */
export function normalizeUserCode(typed: string): string | undefined {
  const letters = typed.toUpperCase().replace(/[^A-Z]/g, "")
  if (letters.length !== 8 || [...letters].some((letter) => !USER_CODE_LETTERS.includes(letter))) return undefined
  return `${letters.slice(0, 4)}-${letters.slice(4)}`
}

/** RFC 8252 §7.3: the app listens on a loopback address, on any port, and the path is ours. */
export function isLoopbackRedirect(uri: string): boolean {
  if (!URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && url.port !== "" && url.pathname === "/callback" && !url.username && !url.password && !url.hash
}
