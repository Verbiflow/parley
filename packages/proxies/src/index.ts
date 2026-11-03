/**
 * Where a connection's traffic leaves the internet from, ordered by how slowly platforms act against it: mobile
 * carrier IPs are shared by thousands of real people; datacenter ranges are the first thing anti-abuse systems flag.
 */
export const PROXY_KINDS = ["mobile", "isp", "residential", "datacenter"] as const
export type ProxyKind = (typeof PROXY_KINDS)[number]

export const PROXY_PROTOCOLS = ["http", "https", "socks5"] as const
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number]

export type Endpoint = { protocol: ProxyProtocol; host: string; port: number; username?: string | undefined; password?: string | undefined }
export type Credentials = { username: string; password: string }

/**
 * A rotating gateway that pins a session to one exit IP when the session id is written into the credentials. Nearly
 * every residential and mobile provider works this way and differs only in spelling, so a provider is data, not code.
 *
 * Template placeholders: `{username}` `{password}` (the provider login), `{country}` / `{COUNTRY}` (ISO 3166-1
 * alpha-2, lower / upper case), `{session}`, `{lifetime}` (minutes).
 */
export type GatewayConfig = {
  protocol: ProxyProtocol
  host: string
  port: number
  usernameTemplate: string
  passwordTemplate: string
  /** How long the provider keeps a session on one IP; after it lapses the same id is re-pinned, possibly elsewhere. */
  sessionLifetimeMinutes: number
}

export const PRESETS = {
  brightdata: {
    label: "Bright Data", kinds: ["residential", "mobile", "isp", "datacenter"],
    gateway: { protocol: "http", host: "brd.superproxy.io", port: 33335, usernameTemplate: "{username}-country-{country}-session-{session}", passwordTemplate: "{password}", sessionLifetimeMinutes: 60 },
  },
  oxylabs: {
    label: "Oxylabs", kinds: ["residential", "mobile"],
    gateway: { protocol: "http", host: "pr.oxylabs.io", port: 7777, usernameTemplate: "customer-{username}-cc-{COUNTRY}-sessid-{session}-sesstime-{lifetime}", passwordTemplate: "{password}", sessionLifetimeMinutes: 1440 },
  },
  decodo: {
    label: "Decodo", kinds: ["residential", "mobile"],
    gateway: { protocol: "http", host: "gate.decodo.com", port: 7000, usernameTemplate: "user-{username}-country-{country}-session-{session}-sessionduration-{lifetime}", passwordTemplate: "{password}", sessionLifetimeMinutes: 1440 },
  },
  iproyal: {
    label: "IPRoyal", kinds: ["residential"],
    gateway: { protocol: "http", host: "geo.iproyal.com", port: 12321, usernameTemplate: "{username}", passwordTemplate: "{password}_country-{country}_session-{session}_lifetime-{lifetime}m", sessionLifetimeMinutes: 1440 },
  },
} as const satisfies Record<string, { label: string; kinds: readonly ProxyKind[]; gateway: GatewayConfig }>

export type PresetId = keyof typeof PRESETS
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

const SESSION_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** Eight lowercase alphanumerics: the narrowest format any preset accepts. */
export function newSessionId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => SESSION_ALPHABET[b % SESSION_ALPHABET.length]).join("")
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`unknown placeholder ${match} in proxy template`)
    return value
  })
}

/** The endpoint for one sticky session on a gateway. */
export function gatewayEndpoint(gateway: GatewayConfig, credentials: Credentials, session: { id: string; country: string }): Endpoint {
  const values = {
    username: credentials.username, password: credentials.password,
    country: session.country.toLowerCase(), COUNTRY: session.country.toUpperCase(),
    session: session.id, lifetime: String(gateway.sessionLifetimeMinutes),
  }
  return { protocol: gateway.protocol, host: gateway.host, port: gateway.port, username: fill(gateway.usernameTemplate, values), password: fill(gateway.passwordTemplate, values) }
}

/** A gateway from a preset with any fields overridden, or wholly custom. Throws if a field is missing. */
export function resolveGateway(preset: PresetId | null, overrides: Partial<GatewayConfig>): GatewayConfig {
  const g = { ...(preset ? PRESETS[preset].gateway : {}), ...overrides } as Partial<GatewayConfig>
  const missing = (["protocol", "host", "port", "usernameTemplate", "passwordTemplate", "sessionLifetimeMinutes"] as const).filter((k) => g[k] === undefined || g[k] === "")
  if (missing.length) throw new Error(`gateway is missing ${missing.join(", ")}`)
  if (!PROXY_PROTOCOLS.includes(g.protocol!)) throw new Error(`unsupported protocol ${g.protocol}`)
  return g as GatewayConfig
}

export function formatProxyUrl(e: Endpoint): string {
  const auth = e.username ? `${encodeURIComponent(e.username)}${e.password !== undefined ? `:${encodeURIComponent(e.password)}` : ""}@` : ""
  return `${e.protocol}://${auth}${e.host}:${e.port}`
}

const DEFAULT_PORTS: Record<ProxyProtocol, number> = { http: 80, https: 443, socks5: 1080 }

export function parseProxyUrl(raw: string): Endpoint {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error("expected a proxy URL such as http://user:pass@host:port")
  }
  const protocol = url.protocol.replace(/:$/, "").replace(/^socks5h$/, "socks5")
  if (!(PROXY_PROTOCOLS as readonly string[]).includes(protocol)) throw new Error(`unsupported proxy protocol ${url.protocol}`)
  return {
    protocol: protocol as ProxyProtocol,
    host: url.hostname,
    port: url.port ? Number(url.port) : DEFAULT_PORTS[protocol as ProxyProtocol],
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  }
}
