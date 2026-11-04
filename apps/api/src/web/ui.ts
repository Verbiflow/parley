/**
 * Parley's design system for the server-rendered console, the same as itsparley.com's: warm black (warm paper in
 * light), Switzer at regular weight, cream gradient buttons with a band of light, glass for secondary controls, cards
 * with a lit top edge, monospace only for what's machine-shaped (ids, numbers, times). Pages (`pages.ts`) compose these.
 */
import { AGENT_BRANDS } from "./agent-brands.ts"
import { LOBEHUB_MARKS } from "./agent-marks.ts"

/** Escape text for HTML bodies and attribute values. Every user- or agent-supplied string goes through this. */
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)

/** Lucide outline icons (24×24, stroke), used sparingly. */
const ICON = {
  moon: `<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
  logout: `<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>`,
  back: `<path d="m15 18-6-6 6-6"/>`,
  arrow: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`,
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  chevronDown: `<path d="m6 9 6 6 6-6"/>`,
  plug: `<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>`,
  external: `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
  settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  github: `<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>`,
  sparkles: `<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>`,
}
export type IconName = keyof typeof ICON
export const icon = (name: IconName, size = 14, stroke = 1.75) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`

/**
 * The channels the console offers, in the site's order: WhatsApp is live, the rest are on the way. Each mark is its
 * own SVG body in its own colors (simple-icons and the brands' published marks; Apple publishes none for iMessage).
 */
export const CHANNELS: Record<string, { name: string; color: string; viewBox?: string; svg: string; tagline: string; live: boolean }> = {
  whatsapp: {
    name: "WhatsApp", color: "#25D366", live: true, tagline: "Your own number, linked as a device",
    svg: `<path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>`,
  },
  imessage: {
    name: "iMessage", color: "#30D158", live: false, tagline: "Your Apple ID's messages",
    svg: `<defs><linearGradient id="pm-im" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6df26a"/><stop offset="1" stop-color="#0dbd2b"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#pm-im)"/><path fill="#fff" d="M12 5.3c-4.2 0-7.6 2.8-7.6 6.2 0 2 1.15 3.75 2.95 4.9-.15 1-.75 2.05-1.6 2.75 1.65-.05 3.05-.65 4.05-1.55.7.15 1.45.25 2.2.25 4.2 0 7.6-2.8 7.6-6.35S16.2 5.3 12 5.3z"/>`,
  },
  slack: {
    name: "Slack", color: "#E01E5A", live: false, tagline: "Direct messages in your workspaces",
    svg: `<path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/><path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/><path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/><path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>`,
  },
  linkedin: {
    name: "LinkedIn", color: "#0A66C2", live: false, tagline: "Messages and connection requests",
    svg: `<path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>`,
  },
  gmail: {
    name: "Gmail", color: "#EA4335", live: false, tagline: "Email from your own address", viewBox: "52 42 88 66",
    svg: `<path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/>`,
  },
}

/** A channel's mark in its own color, no tile: it sits inline with text the way the platforms show it. */
export function channelMark(id: string, size = 16): string {
  const b = CHANNELS[id]
  if (!b) return `<span class="glyph" style="width:${size}px;height:${size}px"></span>`
  return `<svg class="cm" viewBox="${b.viewBox ?? "0 0 24 24"}" width="${size}" height="${size}" aria-hidden="true">${b.svg}</svg>`
}

export const channelName = (id: string) => CHANNELS[id]?.name ?? id.replace(/^./, (c) => c.toUpperCase())

/** Initials in a hairline square: for a contact, a provider, an agent app without a known mark. */
export function glyph(name: string, size = 24, round = false): string {
  const words = name.replace(/@.*/, "").replace(/^\+/, "").split(/[\s._-]+/).filter(Boolean)
  const letters = /^\d/.test(words[0] ?? "") ? "#" : ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase()
  return `<span class="glyph${round ? " round" : ""}" style="width:${size}px;height:${size}px;font-size:${Math.max(9, Math.round(size * 0.4))}px" aria-hidden="true">${esc(letters)}</span>`
}

/** The agent app's own mark when we know it (Claude, Cursor, …), else its initials. */
const lobehub = (m: (typeof LOBEHUB_MARKS)[number], size: number, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"${m.evenodd ? ' fill-rule="evenodd"' : ""} aria-hidden="true">${m.d.map((d) => `<path d="${d}"/>`).join("")}</svg>`

export function agentMark(clientName: string | null, size = 24): string {
  const name = clientName || "MCP client"
  const extra = LOBEHUB_MARKS.find((m) => m.match.test(name))
  if (extra) return `<span class="glyph brand" style="width:${size}px;height:${size}px" title="${esc(extra.title)}">${lobehub(extra, Math.round(size * 0.58))}</span>`
  const brand = AGENT_BRANDS.find((b) => b.match.test(name))
  if (!brand) return glyph(name, size)
  const mono = ["#000000", "#191919", "#18181B", "#0B100F"].includes(brand.hex)
  return `<span class="glyph brand" style="width:${size}px;height:${size}px;${mono ? "" : `color:${brand.hex}`}" title="${esc(brand.title)}"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.58)}" height="${Math.round(size * 0.58)}" fill="currentColor" aria-hidden="true"><path d="${brand.path}"/></svg></span>`
}

/** A bare agent-app mark (no tile) for inline use, e.g. in tabs. Monochrome brands take the text color. */
export function brandMark(title: string, size = 14): string {
  const extra = LOBEHUB_MARKS.find((m) => m.title === title)
  if (extra) return lobehub(extra, size, "cm")
  const brand = AGENT_BRANDS.find((b) => b.title === title)
  if (!brand) return icon("plug", size)
  const mono = ["#000000", "#191919", "#18181B", "#0B100F"].includes(brand.hex)
  return `<svg class="cm" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${mono ? "currentColor" : brand.hex}" aria-hidden="true"><path d="${brand.path}"/></svg>`
}

/** Parley's mark: a chat bubble whose tail forms the stem of a "P". */
export const MARK_PATH = "M16 26A20 20 0 1 1 28 44.33C26 50.5 21.5 55.5 16 58ZM36 18a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"
export const mark = (size = 18) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${MARK_PATH}"/></svg>`
export const LOGO = `<span class="logo">${mark(18)}<span>Parley</span></span>`
/** The mark on the site's cream tile, for the places Parley itself appears (sign-in, consent). */
export const pmark = (size = 40) => `<span class="pmark" style="width:${size}px;height:${size}px">${mark(Math.round(size * 0.56))}</span>`
/** Parley's orb, the site's sign for a message waiting its turn. */
export const orb = (size = 16) => `<span class="orb" style="width:${size}px;height:${size}px" aria-hidden="true"><i></i></span>`

export type Tone = "ok" | "warn" | "bad" | "info" | "idle"
/** A status: a tinted pill with a dot, in sentence case. */
export const status = (tone: Tone, text: string, live = false) => `<span class="st ${tone}"><i class="${live ? "pulse" : ""}"></i>${esc(text.replace(/^./, (c) => c.toUpperCase()))}</span>`

/** A thin usage bar with its numbers beside it. */
export function bar(used: number, of: number): string {
  const pct = of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0
  return `<span class="bar${pct >= 100 ? " full" : pct >= 80 ? " high" : ""}"><span style="width:${pct}%"></span></span>`
}

export function copyLine(text: string, opts: { prompt?: string; multiline?: boolean; wrap?: boolean } = {}): string {
  return `<div class="term${opts.multiline ? " ml" : ""}${opts.wrap ? " ml wrap" : ""}"><code>${opts.prompt ? `<span class="pr">${esc(opts.prompt)}</span>` : ""}${esc(text)}</code><button class="cp" type="button" data-copy="${esc(text)}" aria-label="Copy">${icon("copy", 13)}<span>Copy</span></button></div>`
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** "in 12m", "in 3h 10m", "tue 09:24" — when something happens, in the account's own time zone. */
export function until(iso: string, timeZone = "UTC"): string {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 30_000) return "now"
  if (ms < 3600_000) return `in ${Math.max(1, Math.round(ms / 60_000))}m`
  if (ms < 12 * 3600_000) {
    const mins = Math.round(ms / 60_000)
    return `in ${Math.floor(mins / 60)}h ${mins % 60}m`
  }
  return `${new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "short" }).toLowerCase()} ${clock(iso, timeZone)}`
}

export const clock = (iso: string, timeZone = "UTC") => new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" })
export const stamp = (iso: string, timeZone = "UTC") => new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" })
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const CSS = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
:root{
  --bg:#0d0c0a;--bg-1:#131210;--bg-2:#1a1916;--bg-3:#23211d;--card:#11100e;
  --line:rgba(255,246,232,.07);--line-2:rgba(255,246,232,.11);--line-3:rgba(255,246,232,.18);
  --text:#f3f0ea;--text-2:#d4cec4;--muted:#9d968b;--faint:#6e685f;
  --sand:#e3b98d;--clay:#d9825b;--signal:#e3b98d;--signal-dim:rgba(227,185,141,.14);
  --ok:#79d79f;--warn:#e9b45f;--bad:#f08a73;--info:#e3b98d;--read:#7fcdf0;
  --hover:rgba(255,246,232,.04);--ring:0 0 0 2px var(--bg),0 0 0 3.5px rgba(227,185,141,.7);
  --frame:inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(255,255,255,.065),0 30px 80px -40px rgba(0,0,0,.8);
  --shadow:0 24px 60px -20px rgba(0,0,0,.75);
  --glass:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.025));
  --glass-hi:linear-gradient(180deg,rgba(255,255,255,.115),rgba(255,255,255,.045));
  --glass-ring:inset 0 1px 0 rgba(255,255,255,.08),0 0 0 1px rgba(255,255,255,.09);
  --well:rgba(255,255,255,.03);
  --primary:linear-gradient(180deg,#fffaf3 0%,#f3e6d4 52%,#e6cfb0 100%);--on-primary:#1b140e;
  --primary-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(140,95,50,.22),0 0 0 1px rgba(227,185,141,.55),0 10px 28px -10px rgba(227,185,141,.55);
  --glow:rgba(227,185,141,.075);
  --avatar:linear-gradient(160deg,#3b3129,#221d18);--on-avatar:#e9d6bd;
  --sans:'Switzer',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace;
  --ease:cubic-bezier(.2,.8,.2,1);
  color-scheme:dark;
}
[data-theme=light]{
  --bg:#f6f3ee;--bg-1:#fbf9f5;--bg-2:#efebe4;--bg-3:#e5dfd5;--card:#fffdf9;
  --line:rgba(45,32,20,.08);--line-2:rgba(45,32,20,.13);--line-3:rgba(45,32,20,.22);
  --text:#1d1914;--text-2:#3f3830;--muted:#766d61;--faint:#a79e91;
  --sand:#a36a37;--clay:#b8603a;--signal:#a36a37;--signal-dim:rgba(163,106,55,.12);
  --ok:#2f8a55;--warn:#a8650c;--bad:#b9431f;--info:#a36a37;--read:#2c7fb8;
  --hover:rgba(45,32,20,.04);--ring:0 0 0 2px var(--bg),0 0 0 3.5px rgba(163,106,55,.6);
  --frame:inset 0 1px 0 #fff,0 0 0 1px rgba(45,32,20,.08),0 24px 60px -36px rgba(45,32,20,.35);
  --shadow:0 24px 60px -24px rgba(45,32,20,.3);
  --glass:linear-gradient(180deg,#fff,#f7f3ed);--glass-hi:linear-gradient(180deg,#fff,#efe9e0);
  --glass-ring:inset 0 1px 0 #fff,0 0 0 1px rgba(45,32,20,.12),0 1px 2px rgba(45,32,20,.06);
  --well:#fff;
  --primary:linear-gradient(180deg,#3d342b 0%,#28221c 55%,#1b1712 100%);--on-primary:#fbf6ee;
  --primary-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 -1px 0 rgba(0,0,0,.3),0 0 0 1px #1b1712,0 10px 24px -12px rgba(27,23,18,.6);
  --glow:rgba(201,140,84,.12);
  --avatar:linear-gradient(160deg,#efe4d6,#e0d1bd);--on-avatar:#5c4631;
  color-scheme:light;
}
html,body{margin:0}
body{position:relative;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:21px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh}
body::before{content:"";position:absolute;left:0;right:0;top:0;height:620px;background:radial-gradient(52% 72% at 50% -8%,var(--glow),transparent 72%);pointer-events:none}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:8px}
::selection{background:rgba(227,185,141,.28)}
p{margin:0}
code,.mono{font-family:var(--mono);font-size:12.5px;letter-spacing:-.01em}
.muted{color:var(--muted)}.faint{color:var(--faint)}
.label{font-size:12.5px;color:var(--muted)}
.logo{display:inline-flex;align-items:center;gap:8px;font-weight:500;font-size:15px;letter-spacing:-.02em;color:var(--text)}
.cm{flex:none;display:inline-block;vertical-align:-3px}
.glyph{display:inline-grid;place-items:center;flex:none;border-radius:8px;font-size:11px;font-weight:500;color:var(--on-avatar);background:var(--avatar);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 0 0 1px rgba(255,246,232,.06);letter-spacing:.01em}
.glyph.round{border-radius:50%}
.glyph.brand{background:var(--glass);box-shadow:var(--glass-ring);color:var(--text)}
.pmark{display:inline-grid;place-items:center;flex:none;border-radius:28%;background:linear-gradient(180deg,#fffaf3,#e6cfb0);color:#1b140e;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 0 0 1px rgba(227,185,141,.45),0 10px 30px -10px rgba(227,185,141,.5)}

/* buttons: cream gradient with a band of light on hover (and now and then on large ones); glass for the rest */
.btn{position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 15px;font-size:13.5px;font-weight:500;letter-spacing:-.005em;border-radius:999px;border:0;background:var(--primary);color:var(--on-primary);box-shadow:var(--primary-shadow);cursor:pointer;white-space:nowrap;transition:filter .15s var(--ease),color .15s var(--ease),transform .15s var(--ease),box-shadow .15s var(--ease)}
.btn::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.7) 50%,transparent 70%);transform:translateX(-130%);pointer-events:none}
.btn:hover{filter:brightness(1.04)}.btn:hover::after{animation:sheen .9s var(--ease)}
.btn:active{transform:scale(.98)}
.btn.lg::after{animation:sheen-loop 7s var(--ease) 1.5s infinite}.btn.lg:hover::after{animation:sheen .9s var(--ease)}
[data-theme=light] .btn::after{background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.22) 50%,transparent 70%)}
@keyframes sheen{from{transform:translateX(-130%)}to{transform:translateX(130%)}}
@keyframes sheen-loop{0%{transform:translateX(-130%)}14%,100%{transform:translateX(130%)}}
.btn.line,.btn.warn,.btn.quiet{filter:none}.btn.line::after,.btn.warn::after,.btn.quiet::after{display:none}
.btn.line{background:var(--glass);color:var(--text-2);box-shadow:var(--glass-ring)}.btn.line:hover{background:var(--glass-hi);color:var(--text)}
.btn.quiet{background:transparent;box-shadow:none;color:var(--muted)}.btn.quiet:hover{color:var(--text);background:var(--hover)}
.btn.warn{background:var(--glass);box-shadow:var(--glass-ring);color:var(--bad)}.btn.warn:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 8%,transparent)}
.btn.sm{height:28px;padding:0 12px;font-size:12.5px;gap:6px}
.btn.lg{height:40px;padding:0 20px;font-size:14px}
.btn.block{width:100%}
.btn .ar{transition:transform .15s var(--ease)}.btn:hover .ar{transform:translateX(2px)}

/* status: a tinted pill with a dot, the way the site shows message states */
.st{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px 0 8px;border-radius:999px;font-size:12px;font-weight:500;letter-spacing:-.005em;color:var(--muted);background:color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap;line-height:1}
.st i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.st.ok{color:var(--ok)}.st.warn{color:var(--warn)}.st.bad{color:var(--bad)}.st.info{color:var(--info)}
.st.ok i.pulse{box-shadow:0 0 0 0 currentColor;animation:ping 2s var(--ease) infinite}
@keyframes ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 55%,transparent)}70%,100%{box-shadow:0 0 0 6px transparent}}
.pulse{animation:pulse 2.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
.kind{font-size:12.5px;color:var(--muted)}
.kind.open{color:var(--sand)}

/* Parley's orb: sand and cream light turning inside a glass sphere, for anything waiting its turn to send */
.orb{position:relative;display:inline-block;flex:none;overflow:hidden;isolation:isolate;border-radius:50%;vertical-align:middle;background:radial-gradient(circle at 50% 60%,#3a2516 0%,#140d08 75%);box-shadow:0 0 0 .5px rgba(255,236,210,.3),0 0 12px rgba(227,185,141,.45),0 0 28px rgba(227,185,141,.16)}
.orb::before,.orb::after{content:"";position:absolute;inset:-20%;mix-blend-mode:screen;filter:blur(3px);animation:orb-turn 3.2s linear infinite}
.orb::before{background:radial-gradient(circle at 28% 30%,#fff1dc 0,rgba(255,241,220,0) 30%),radial-gradient(circle at 74% 58%,#e3b98d 0,rgba(227,185,141,0) 34%),radial-gradient(circle at 42% 84%,#b8794a 0,rgba(184,121,74,0) 34%)}
.orb::after{background:radial-gradient(circle at 70% 24%,#f8d6ac 0,rgba(248,214,172,0) 28%),radial-gradient(circle at 22% 66%,#f0cda5 0,rgba(240,205,165,0) 30%);opacity:.85;animation-duration:4.6s;animation-direction:reverse}
.orb > i{position:absolute;inset:0;border-radius:50%;z-index:1;background:radial-gradient(circle at 33% 24%,rgba(255,255,255,.9),rgba(255,255,255,0) 22%),radial-gradient(circle at 50% 50%,transparent 60%,rgba(20,13,8,.55) 82%,rgba(255,226,190,.4) 98%)}
@keyframes orb-turn{to{transform:rotate(1turn)}}

.input,.select,.textarea{width:100%;height:36px;padding:0 12px;border-radius:10px;border:0;background:var(--well);box-shadow:inset 0 0 0 1px var(--line-2);color:var(--text);outline:none;transition:box-shadow .15s var(--ease),background .15s var(--ease);font-size:13.5px}
.textarea{height:auto;padding:10px 12px;resize:vertical;font-family:var(--mono);font-size:12.5px;line-height:19px}
.select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239d968b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;padding-right:32px}
.input:hover,.select:hover,.textarea:hover{box-shadow:inset 0 0 0 1px var(--line-3)}
.input:focus,.select:focus,.textarea:focus{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sand) 70%,transparent),0 0 0 4px color-mix(in srgb,var(--sand) 14%,transparent)}
.input::placeholder,.textarea::placeholder{color:var(--faint)}
.field{display:flex;flex-direction:column;gap:7px;min-width:0}
.field > span{font-size:12.5px;color:var(--muted)}
.field > small{font-size:12px;color:var(--faint)}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}

/* frame: the top bar sits clear over the page's glow, and turns to frosted glass once the page scrolls under it */
.top{position:sticky;top:0;z-index:30;transition:background .25s var(--ease),box-shadow .25s var(--ease)}
.top.scrolled{background:color-mix(in srgb,var(--bg) 74%,transparent);backdrop-filter:saturate(1.5) blur(18px);-webkit-backdrop-filter:saturate(1.5) blur(18px);box-shadow:0 1px 0 var(--line),0 16px 40px -30px rgba(0,0,0,.7)}
.top-in{position:relative;max-width:1200px;margin:0 auto;height:64px;padding:0 28px;display:flex;align-items:center;gap:16px}
.top .home{display:inline-flex;align-items:center;height:34px;padding:0 6px;margin-left:-6px;border-radius:10px}
.tabs{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:var(--well);box-shadow:inset 0 0 0 1px var(--line),inset 0 1px 2px rgba(0,0,0,.22)}
.tab{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:30px;padding:0 15px;border-radius:999px;font-size:13.5px;color:var(--muted);white-space:nowrap;transition:color .15s var(--ease),background .15s var(--ease),box-shadow .15s var(--ease)}
.tab:hover{color:var(--text)}
.tab.on{color:var(--text);background:var(--glass-hi);box-shadow:var(--glass-ring),0 4px 12px -4px rgba(0,0,0,.45)}
.tab .n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--hover);box-shadow:inset 0 0 0 1px var(--line);font-size:11px;font-weight:500;line-height:1;color:var(--text-2);font-variant-numeric:tabular-nums}
.tab .n.q{background:color-mix(in srgb,var(--sand) 15%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sand) 28%,transparent);color:var(--sand)}
.top .right{margin-left:auto;display:flex;align-items:center;gap:8px}
.icon-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:999px;border:0;background:var(--glass);box-shadow:var(--glass-ring);color:var(--text-2);cursor:pointer;transition:color .15s,background .15s}
.icon-btn:hover{color:var(--text);background:var(--glass-hi)}
.th-d,[data-theme=light] .th-l{display:none!important}[data-theme=light] .th-d{display:inline!important}
.me{position:relative}
.me summary{list-style:none;cursor:pointer;border-radius:999px;display:block}
.me summary::-webkit-details-marker{display:none}
.acct{display:flex!important;align-items:center;gap:8px;height:34px;padding:0 11px 0 5px;background:var(--glass);box-shadow:var(--glass-ring);font-size:13.5px;color:var(--text-2);transition:color .15s,background .15s}
.acct:hover,.me[open] .acct{color:var(--text);background:var(--glass-hi)}
.acct .an{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct .chev{display:inline-flex;color:var(--faint);transition:transform .2s var(--ease)}.me[open] .acct .chev{transform:rotate(180deg)}
.menu{position:absolute;right:0;top:calc(100% + 10px);width:260px;padding:6px;border-radius:16px;background:color-mix(in srgb,var(--card) 94%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:var(--frame),var(--shadow);z-index:40;transform-origin:top right;animation:pop .16s var(--ease)}
@keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
.menu .mh{display:flex;align-items:center;gap:11px;padding:10px 10px 12px;border-bottom:1px solid var(--line);margin-bottom:5px}
.menu .mh div{min-width:0}.menu .mh b{display:block;font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.menu .mh div span{display:block;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu a,.menu button{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 10px;border:0;background:none;border-radius:10px;font-size:13.5px;color:var(--text-2);cursor:pointer;text-align:left}
.menu a svg,.menu button svg{color:var(--muted)}
.menu a:hover,.menu button:hover{background:var(--hover);color:var(--text)}.menu a:hover svg,.menu button:hover svg{color:var(--text)}
.menu .ext{margin-left:auto;color:var(--faint)}
.menu .sep{height:1px;background:var(--line);margin:5px 4px}
.menu .out:hover{color:var(--bad)}.menu .out:hover svg{color:var(--bad)}
.av{border-radius:50%;object-fit:cover;flex:none;display:block;box-shadow:0 0 0 1px var(--line-2)}

.wrap{position:relative;max-width:1200px;margin:0 auto;padding:52px 28px 120px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-bottom:32px}
.head .crumb{display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;font-size:13px}
.head .crumb:hover{color:var(--text)}
.head h1{margin:0;font-size:36px;line-height:42px;font-weight:400;letter-spacing:-.035em;display:flex;align-items:center;gap:14px}
.head p.sub{margin-top:12px;font-size:15px;line-height:24px;color:var(--muted);max-width:60ch}
.head .acts{display:flex;align-items:center;gap:8px;flex:none}

/* sections: a title over a hairline, then the content on the page itself */
.sec{margin-top:52px}
.head + .sec,.head + .note + .sec{margin-top:8px}
.sec-h{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.sec-h .label{display:inline-flex;align-items:center;font-size:15px;font-weight:500;letter-spacing:-.012em;color:var(--text)}
.sec-h .aside{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:10px}
.sec-h .aside a{color:var(--text-2)}.sec-h .aside a:hover{color:var(--text)}
.fold > summary{cursor:pointer;list-style:none;user-select:none}.fold > summary::-webkit-details-marker{display:none}
.fold > summary:hover .label{color:var(--text)}
.fold .chev{display:inline-flex;color:var(--muted);transition:transform .2s var(--ease)}.fold:not([open]) .chev{transform:rotate(-90deg)}
.fold:not([open]) > summary{border-bottom-color:var(--line)}
.sec-note{font-size:13.5px;line-height:22px;color:var(--muted);padding:14px 0 0;max-width:70ch}

.strip{display:flex;flex-wrap:wrap;border-radius:16px;overflow:hidden;background:var(--card);box-shadow:var(--frame)}
.strip > div{flex:1;min-width:150px;padding:18px 20px 20px;border-right:1px solid var(--line)}
.strip > div:last-child{border-right:0}
.strip .v{display:flex;align-items:center;gap:10px;font-size:30px;line-height:36px;font-weight:400;letter-spacing:-.035em;color:var(--text);margin-top:10px;font-variant-numeric:tabular-nums}
.strip .h{font-size:12.5px;color:var(--faint);margin-top:2px}

.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:12.5px;font-weight:400;color:var(--faint);padding:14px 14px 10px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:14px 14px 14px 0;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13.5px}
.tbl tbody tr{transition:background .12s}
.tbl tbody tr:hover{background:var(--hover)}
.tbl tr.link{cursor:pointer}
.tbl .m{font-family:var(--mono);font-size:12.5px;color:var(--text-2);white-space:nowrap;font-variant-numeric:tabular-nums}
.tbl .clip{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)}
.tbl .r{text-align:right;padding-right:0;color:var(--faint)}
.next{display:inline-flex;align-items:center;gap:8px}
.tbl tr.link:hover .r{color:var(--text)}
.who{display:flex;align-items:center;gap:11px;white-space:nowrap}
.who b{font-weight:500}
.who small{display:block;font-size:12px;color:var(--faint);margin-top:1px}

.bar{display:inline-block;vertical-align:middle;width:88px;height:4px;border-radius:99px;background:var(--bg-3);overflow:hidden}
.bar > span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#b8794a,#f0cda5)}
.bar.high > span{background:var(--warn)}.bar.full > span{background:var(--bad)}

.term{display:flex;align-items:center;gap:10px;padding:0 6px 0 16px;min-height:46px;border-radius:12px;background:var(--well);box-shadow:inset 0 0 0 1px var(--line-2);min-width:0}
.term code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-size:12.5px}
.term .pr{color:var(--faint);margin-right:8px;user-select:none}
.term.ml{align-items:flex-start;padding:14px 6px 14px 16px}.term.ml code{white-space:pre;overflow:auto;line-height:19px}
.term.wrap code{white-space:pre-wrap;font-family:var(--sans);font-size:13.5px;line-height:22px;color:var(--text-2);padding-right:8px}
.cp{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:999px;background:var(--glass);box-shadow:var(--glass-ring);color:var(--text-2);font-size:12.5px;font-weight:500;cursor:pointer;flex:none;transition:background .15s,color .15s}
.cp:hover{color:var(--text);background:var(--glass-hi)}

.note{display:flex;gap:14px;align-items:center;padding:16px 18px;border-radius:14px;background:var(--card);box-shadow:var(--frame),inset 2px 0 0 var(--muted)}
.note.bad{box-shadow:var(--frame),inset 2px 0 0 var(--bad)}.note.warn{box-shadow:var(--frame),inset 2px 0 0 var(--warn)}.note.ok{box-shadow:var(--frame),inset 2px 0 0 var(--ok)}
.note .grow{flex:1;min-width:0}.note b{font-weight:500}.note p{font-size:13px;color:var(--muted);margin-top:3px}

.empty{padding:44px 0;color:var(--muted);font-size:13.5px}
.empty b{display:block;color:var(--text);font-weight:500;margin-bottom:4px;font-size:14.5px}
.empty code{color:var(--text-2)}

.kv{display:grid;grid-template-columns:180px 1fr;border-top:1px solid var(--line)}
.kv > div{padding:13px 0;border-bottom:1px solid var(--line);font-size:13.5px;min-width:0}
.kv .k{font-size:13px;color:var(--muted)}

.log{font-size:13px;line-height:20px}
.log > div{display:grid;grid-template-columns:72px 92px minmax(0,190px) minmax(0,1fr);gap:16px;padding:11px 0;border-bottom:1px solid var(--line);align-items:center}
.log .t{font-family:var(--mono);font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.log .e{justify-self:start;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:500;color:var(--text-2);background:color-mix(in srgb,currentColor 12%,transparent)}
.log .e.ok{color:var(--ok)}.log .e.bad{color:var(--bad)}.log .e.q{color:var(--sand)}
.log .to{font-family:var(--mono);font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.log.multi > div{grid-template-columns:72px 92px minmax(0,150px) minmax(0,190px) minmax(0,1fr)}.log .fr{font-family:var(--mono);font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.log .b{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.seg{display:inline-flex;gap:2px;border-radius:999px;padding:3px;background:var(--well);box-shadow:inset 0 0 0 1px var(--line)}
.seg button,.seg a{height:28px;padding:0 13px;border:0;background:none;border-radius:999px;font-size:12.5px;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;transition:color .15s,background .15s}
.seg button:hover,.seg a:hover{color:var(--text)}
.seg .on{background:var(--glass-hi);box-shadow:var(--glass-ring);color:var(--text)}

.split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:56px;align-items:start}
@media (max-width:980px){.split{grid-template-columns:1fr;gap:28px}.tabs{position:static;transform:none;margin-left:8px}}
@media (max-width:760px){
  .top-in{height:auto;flex-wrap:wrap;padding:12px 16px;row-gap:12px}
  .tabs{position:static;transform:none;order:3;flex:1 0 100%;overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tab{flex:1 1 auto;padding:0 10px;font-size:13px;gap:6px}
  .acct .an,.acct .chev{display:none}.acct{padding:0 5px}
  .wrap{padding:32px 16px 80px}.head{flex-direction:column;align-items:flex-start}.head h1{font-size:30px;line-height:36px}
  .kv{grid-template-columns:1fr}.kv .k{padding-bottom:0;border-bottom:0}
  .log > div,.log.multi > div{grid-template-columns:64px 1fr;row-gap:4px}.log .fr,.log .to,.log .b{grid-column:2}
  .strip > div{min-width:50%;border-bottom:1px solid var(--line)}
  .sec-h{flex-wrap:wrap;row-gap:12px}.sec-h .aside{flex-wrap:wrap}
  .tbl{display:block;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.tbl::-webkit-scrollbar{display:none}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`

const BOOT = `try{var t=localStorage.getItem("parley-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`

/** Behavior every page shares: theme toggle, copy buttons, tabs, the account menu, confirmations, row links. */
const SCRIPT = `
document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{const r=document.documentElement;const t=r.dataset.theme==='light'?'dark':'light';r.dataset.theme=t;try{localStorage.setItem('parley-theme',t)}catch(e){}}));
document.addEventListener('click',e=>{const m=document.querySelector('.me');if(m&&m.open&&!m.contains(e.target))m.open=false});
document.addEventListener('keydown',e=>{const m=document.querySelector('.me');if(e.key==='Escape'&&m&&m.open){m.open=false;m.querySelector('summary').focus()}});
(()=>{const t=document.querySelector('.top');if(!t)return;const f=()=>t.classList.toggle('scrolled',scrollY>4);f();addEventListener('scroll',f,{passive:true})})();
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);const s=b.querySelector('span');if(s){const t=s.textContent;s.textContent='Copied';setTimeout(()=>s.textContent=t,1400)}}catch(e){}}));
document.querySelectorAll('[data-tabs]').forEach(t=>t.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(!b)return;const box=t.closest('[data-tabbox]')||document;t.querySelectorAll('button[data-tab]').forEach(x=>x.classList.toggle('on',x===b));box.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==b.dataset.tab)}));
document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}));
document.querySelectorAll('tr[data-href]').forEach(r=>r.addEventListener('click',e=>{if(!e.target.closest('a,button,form'))location.href=r.dataset.href}));
`

export function shell(title: string, body: string, opts: { css?: string; script?: string } = {}): string {
  return `<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="#0d0c0a"><script>${BOOT}</script><title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d0c0a"/><g transform="translate(11 9) scale(.68)"><path fill="#f3f0ea" fill-rule="evenodd" d="${MARK_PATH}"/></g></svg>`)}">
<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}${opts.css ?? ""}</style></head><body>${body}<script>${SCRIPT}${opts.script ?? ""}</script></body></html>`
}

export type Viewer = { name: string; email: string; image: string | null; signedInWith: string | null; createdAt: string }

export function avatar(u: Viewer, size = 26): string {
  if (u.image && /^https:\/\//.test(u.image)) return `<img class="av" src="${esc(u.image)}" alt="" referrerpolicy="no-referrer" style="width:${size}px;height:${size}px">`
  return glyph(u.name || u.email, size, true)
}

/** Network (proxy providers) is hidden from the console for now; /app/network still works. Flip to bring it back. */
export const SHOW_NETWORK = false

export type Section = "overview" | "outbox" | "agents" | "network" | "settings"

/** The signed-in frame: a top bar (mark, workspace, tabs, theme, account) over the page. */
export function appShell(opts: { title: string; active: Section; user: Viewer; counts?: Partial<Record<Section, number>>; css?: string; script?: string; body: string }): string {
  const { user } = opts
  const tab = (id: Section, href: string, label: string) => {
    const n = opts.counts?.[id]
    return `<a class="tab${opts.active === id ? " on" : ""}" href="${href}"${opts.active === id ? ' aria-current="page"' : ""}>${label}${n ? `<span class="n${id === "outbox" ? " q" : ""}" aria-label="${n} ${id === "outbox" ? "queued" : "connected"}">${n}</span>` : ""}</a>`
  }
  const first = (user.name || user.email).split(/[\s@]/)[0]!
  return shell(`${opts.title} · Parley`, `
    <header class="top"><div class="top-in">
      <a class="home" href="/app" aria-label="Parley overview">${LOGO}</a>
      <nav class="tabs" aria-label="Sections">${tab("overview", "/app", "Overview")}${tab("outbox", "/app/outbox", "Outbox")}${tab("agents", "/app/agents", "Agents")}${SHOW_NETWORK ? tab("network", "/app/network", "Network") : ""}${tab("settings", "/app/settings", "Settings")}</nav>
      <div class="right">
        <button class="icon-btn" type="button" data-theme-toggle title="Toggle theme" aria-label="Toggle theme"><span class="th-l">${icon("sun", 15)}</span><span class="th-d">${icon("moon", 15)}</span></button>
        <details class="me"><summary class="acct" aria-label="Account">${avatar(user, 24)}<span class="an">${esc(first)}</span><span class="chev">${icon("chevronDown", 13)}</span></summary>
          <div class="menu"><div class="mh">${avatar(user, 34)}<div><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div></div>
            <a href="/app/settings">${icon("settings", 15)}Settings</a>
            <a href="https://itsparley.com" target="_blank" rel="noopener">${mark(15)}itsparley.com<span class="ext">${icon("external", 12)}</span></a>
            <a href="https://github.com/Verbiflow/parley" target="_blank" rel="noopener">${icon("github", 15)}GitHub<span class="ext">${icon("external", 12)}</span></a>
            <div class="sep"></div>
            <form method="post" action="/auth/signout"><button class="out" type="submit">${icon("logout", 15)}Sign out</button></form></div>
        </details>
      </div>
    </div></header>
    <main class="wrap">${opts.body}</main>`, { css: opts.css, script: opts.script })
}

export function pageHead(opts: { title: string; sub?: string; crumb?: { href: string; label: string }; actions?: string; lead?: string }): string {
  return `<header class="head"><div>${opts.crumb ? `<a class="crumb label" href="${opts.crumb.href}">${icon("back", 12)}${esc(opts.crumb.label)}</a>` : ""}
    <h1>${opts.lead ?? ""}${esc(opts.title)}</h1>${opts.sub ? `<p class="sub">${opts.sub}</p>` : ""}</div>${opts.actions ? `<div class="acts">${opts.actions}</div>` : ""}</header>`
}

/** A section that folds: the header is the toggle (native <details>, works without JS). */
export const foldSection = (label: string, body: string, opts: { aside?: string; note?: string; open?: boolean; lead?: string } = {}) =>
  `<details class="sec fold"${opts.open ? " open" : ""}><summary class="sec-h"><span class="label">${opts.lead ?? ""}${esc(label)}</span><span class="aside">${opts.aside ?? ""}<span class="chev">${icon("chevronDown", 14)}</span></span></summary>${opts.note ? `<p class="sec-note">${opts.note}</p>` : ""}${body}</details>`

export const section = (label: string, body: string, aside = "", note = "", lead = "") =>
  `<section class="sec"><div class="sec-h"><span class="label">${lead}${esc(label)}</span>${aside ? `<span class="aside">${aside}</span>` : ""}</div>${note ? `<p class="sec-note">${note}</p>` : ""}${body}</section>`

export const empty = (title: string, text: string, action = "") =>
  `<div class="empty"><b>${esc(title)}</b>${text}${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div>`
