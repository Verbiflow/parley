/**
 * Parley's design system for the server-rendered console: tokens, the page frame, icons, and the few components
 * pages are built from. Dark warm-black by default, warm paper in light; regular-weight headlines, monospace for
 * everything machine-shaped (labels, ids, numbers, times). Pages (`pages.ts`) compose these.
 */
import { AGENT_BRANDS } from "./agent-brands.ts"

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
}
export type IconName = keyof typeof ICON
export const icon = (name: IconName, size = 14, stroke = 1.75) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`

/** Real channel marks (simple-icons paths, 24×24). */
export const CHANNELS: Record<string, { name: string; color: string; path: string; tagline: string; live: boolean }> = {
  whatsapp: {
    name: "WhatsApp", color: "#25D366", live: true, tagline: "Your own number, linked as a device",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  telegram: {
    name: "Telegram", color: "#229ED9", live: false, tagline: "Bots and personal accounts",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  instagram: {
    name: "Instagram", color: "#E4405F", live: false, tagline: "Direct messages",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  linkedin: {
    name: "LinkedIn", color: "#0A66C2", live: false, tagline: "Messages and connection requests",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
}

/** A channel's mark in its own color, no tile: it sits inline with text the way the platforms show it. */
export function channelMark(id: string, size = 16): string {
  const b = CHANNELS[id]
  if (!b) return `<span class="glyph" style="width:${size}px;height:${size}px"></span>`
  return `<svg class="cm" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${b.color}" aria-hidden="true"><path d="${b.path}"/></svg>`
}

export const channelName = (id: string) => CHANNELS[id]?.name ?? id.replace(/^./, (c) => c.toUpperCase())

/** Initials in a hairline square: for a contact, a provider, an agent app without a known mark. */
export function glyph(name: string, size = 24, round = false): string {
  const words = name.replace(/@.*/, "").replace(/^\+/, "").split(/[\s._-]+/).filter(Boolean)
  const letters = /^\d/.test(words[0] ?? "") ? "#" : ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase()
  return `<span class="glyph${round ? " round" : ""}" style="width:${size}px;height:${size}px;font-size:${Math.max(9, Math.round(size * 0.4))}px" aria-hidden="true">${esc(letters)}</span>`
}

/** The agent app's own mark when we know it (Claude, Cursor, …), else its initials. */
export function agentMark(clientName: string | null, size = 24): string {
  const name = clientName || "MCP client"
  const brand = AGENT_BRANDS.find((b) => b.match.test(name))
  if (!brand) return glyph(name, size)
  const mono = ["#000000", "#191919", "#18181B", "#0B100F"].includes(brand.hex)
  return `<span class="glyph brand" style="width:${size}px;height:${size}px;${mono ? "" : `color:${brand.hex}`}" title="${esc(brand.title)}"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.58)}" height="${Math.round(size * 0.58)}" fill="currentColor" aria-hidden="true"><path d="${brand.path}"/></svg></span>`
}

/** A bare agent-app mark (no tile) for inline use, e.g. in tabs. Monochrome brands take the text color. */
export function brandMark(title: string, size = 14): string {
  const brand = AGENT_BRANDS.find((b) => b.title === title)
  if (!brand) return icon("plug", size)
  const mono = ["#000000", "#191919", "#18181B", "#0B100F"].includes(brand.hex)
  return `<svg class="cm" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${mono ? "currentColor" : brand.hex}" aria-hidden="true"><path d="${brand.path}"/></svg>`
}

/** Parley's mark: a chat bubble whose tail forms the stem of a "P". */
const MARK_PATH = "M16 26A20 20 0 1 1 28 44.33C26 50.5 21.5 55.5 16 58ZM36 18a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"
export const mark = (size = 18) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${MARK_PATH}"/></svg>`
export const LOGO = `<span class="logo">${mark(18)}<span>parley</span></span>`

export type Tone = "ok" | "warn" | "bad" | "info" | "idle"
/** A status: a colored dot and a monospace word. */
export const status = (tone: Tone, text: string, live = false) => `<span class="st ${tone}"><i class="${live ? "pulse" : ""}"></i>${esc(text)}</span>`

/** A thin usage bar with its numbers beside it. */
export function bar(used: number, of: number): string {
  const pct = of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0
  return `<span class="bar${pct >= 100 ? " full" : pct >= 80 ? " high" : ""}"><span style="width:${pct}%"></span></span>`
}

export function copyLine(text: string, opts: { prompt?: string; multiline?: boolean } = {}): string {
  return `<div class="term${opts.multiline ? " ml" : ""}"><code>${opts.prompt ? `<span class="pr">${esc(opts.prompt)}</span>` : ""}${esc(text)}</code><button class="cp" type="button" data-copy="${esc(text)}" aria-label="Copy">${icon("copy", 13)}<span>copy</span></button></div>`
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
  if (ms < 12 * 3600_000) return `in ${Math.floor(ms / 3600_000)}h ${Math.round((ms % 3600_000) / 60_000)}m`
  return `${new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "short" }).toLowerCase()} ${clock(iso, timeZone)}`
}

export const clock = (iso: string, timeZone = "UTC") => new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" })
export const stamp = (iso: string, timeZone = "UTC") => new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" })
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const CSS = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
:root{
  --bg:#0c0c0b;--bg-1:#111110;--bg-2:#171715;--bg-3:#1e1e1b;
  --line:rgba(237,234,224,.075);--line-2:rgba(237,234,224,.12);--line-3:rgba(237,234,224,.2);
  --text:#edebe4;--text-2:#c4c1b8;--muted:#8d8a82;--faint:#5e5c57;
  --ink:#edebe4;--ink-2:#ffffff;--on-ink:#0c0c0b;
  --signal:#c6f36d;--signal-dim:rgba(198,243,109,.14);
  --ok:#8fdc6a;--warn:#f0b35a;--bad:#f2785c;--info:#7fb4f5;
  --hover:rgba(237,234,224,.04);--ring:0 0 0 2px var(--bg),0 0 0 3px var(--text-2);
  --shadow:0 24px 60px -20px rgba(0,0,0,.7);
  --sans:'Geist',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace;
  --ease:cubic-bezier(.2,.8,.2,1);
  color-scheme:dark;
}
[data-theme=light]{
  --bg:#f7f6f1;--bg-1:#fbfaf6;--bg-2:#efede6;--bg-3:#e7e4db;
  --line:rgba(28,27,23,.09);--line-2:rgba(28,27,23,.14);--line-3:rgba(28,27,23,.24);
  --text:#1c1b17;--text-2:#3d3b35;--muted:#6f6c64;--faint:#a3a097;
  --ink:#1c1b17;--ink-2:#000;--on-ink:#f7f6f1;
  --signal:#3f7d0f;--signal-dim:rgba(63,125,15,.1);
  --ok:#3f7d0f;--warn:#a8650c;--bad:#b9431f;--info:#2c62b5;
  --hover:rgba(28,27,23,.035);--ring:0 0 0 2px var(--bg),0 0 0 3px var(--text-2);
  --shadow:0 24px 60px -24px rgba(28,27,23,.25);
  color-scheme:light;
}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:21px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh;font-feature-settings:"ss01","cv11"}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:4px}
::selection{background:var(--signal-dim)}
p{margin:0}
code,.mono{font-family:var(--mono);font-size:12.5px;letter-spacing:-.01em}
.muted{color:var(--muted)}.faint{color:var(--faint)}
.label{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.logo{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-weight:500;font-size:14px;letter-spacing:-.02em}
.cm{flex:none;display:inline-block;vertical-align:-3px}
.glyph{display:inline-grid;place-items:center;flex:none;border:1px solid var(--line-2);border-radius:5px;font-family:var(--mono);font-weight:500;color:var(--text-2);background:var(--bg-2);letter-spacing:0}
.glyph.round{border-radius:50%}
.glyph.brand{background:var(--bg-2);color:var(--text)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:32px;padding:0 14px;font-size:13px;font-weight:500;border-radius:999px;border:1px solid var(--ink);background:var(--ink);color:var(--on-ink);cursor:pointer;white-space:nowrap;transition:background .15s var(--ease),border-color .15s var(--ease),color .15s var(--ease),opacity .15s}
.btn:hover{background:var(--ink-2);border-color:var(--ink-2)}
.btn.line{background:transparent;color:var(--text);border-color:var(--line-3)}.btn.line:hover{border-color:var(--text-2);background:var(--hover)}
.btn.quiet{background:transparent;border-color:transparent;color:var(--muted)}.btn.quiet:hover{color:var(--text);background:var(--hover)}
.btn.warn{background:transparent;border-color:var(--line-3);color:var(--bad)}.btn.warn:hover{border-color:var(--bad)}
.btn.sm{height:26px;padding:0 11px;font-size:12.5px}
.btn.lg{height:40px;padding:0 20px;font-size:14px}
.btn.block{width:100%}
.btn .ar{transition:transform .15s var(--ease)}.btn:hover .ar{transform:translateX(2px)}

.st{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px;color:var(--muted);white-space:nowrap}
.st i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.st.ok{color:var(--ok)}.st.warn{color:var(--warn)}.st.bad{color:var(--bad)}.st.info{color:var(--info)}
.pulse{animation:pulse 2.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
.kind{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.kind.open{color:var(--signal)}

.input,.select,.textarea{width:100%;height:34px;padding:0 11px;border-radius:6px;border:1px solid var(--line-2);background:var(--bg-1);color:var(--text);outline:none;transition:border-color .15s var(--ease);font-size:13.5px}
.textarea{height:auto;padding:9px 11px;resize:vertical;font-family:var(--mono);font-size:12.5px;line-height:19px}
.select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238d8a82' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
.input:hover,.select:hover,.textarea:hover{border-color:var(--line-3)}
.input:focus,.select:focus,.textarea:focus{border-color:var(--text-2)}
.input::placeholder,.textarea::placeholder{color:var(--faint)}
.field{display:flex;flex-direction:column;gap:7px;min-width:0}
.field > span{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.field > small{font-size:12px;color:var(--faint)}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}

/* frame */
.top{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1200px;margin:0 auto;height:52px;padding:0 28px;display:flex;align-items:center;gap:22px}
.top .ws{display:flex;align-items:center;gap:10px;min-width:0}
.top .ws .sl{color:var(--faint)}
.top .ws .wn{font-size:13px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.tabs{display:flex;align-items:center;gap:2px;margin-left:10px}
.tab{position:relative;display:inline-flex;align-items:center;gap:6px;height:52px;padding:0 10px;font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);transition:color .15s}
.tab:hover{color:var(--text)}
.tab.on{color:var(--text)}.tab.on::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:1px;background:var(--text)}
.tab .n{font-size:10.5px;color:var(--faint);letter-spacing:0}
.top .right{margin-left:auto;display:flex;align-items:center;gap:6px}
.icon-btn{display:grid;place-items:center;width:30px;height:30px;border-radius:999px;border:0;background:none;color:var(--muted);cursor:pointer}
.icon-btn:hover{color:var(--text);background:var(--hover)}
.th-d,[data-theme=light] .th-l{display:none!important}[data-theme=light] .th-d{display:inline!important}
.me{position:relative}
.me summary{list-style:none;cursor:pointer;border-radius:999px;display:block}
.me summary::-webkit-details-marker{display:none}
.menu{position:absolute;right:0;top:calc(100% + 8px);width:240px;padding:6px;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-1);box-shadow:var(--shadow);z-index:40}
.menu .mh{padding:8px 10px 10px;border-bottom:1px solid var(--line);margin-bottom:4px}
.menu .mh b{display:block;font-weight:500;font-size:13px}.menu .mh span{font-family:var(--mono);font-size:11.5px;color:var(--muted);word-break:break-all}
.menu a,.menu button{display:flex;align-items:center;gap:9px;width:100%;height:32px;padding:0 10px;border:0;background:none;border-radius:6px;font-size:13px;color:var(--text-2);cursor:pointer;text-align:left}
.menu a:hover,.menu button:hover{background:var(--hover);color:var(--text)}
.av{border-radius:50%;object-fit:cover;flex:none;display:block;border:1px solid var(--line-2)}

.wrap{max-width:1200px;margin:0 auto;padding:44px 28px 120px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-bottom:28px}
.head .crumb{display:inline-flex;align-items:center;gap:6px;margin-bottom:14px}
.head .crumb:hover{color:var(--text)}
.head h1{margin:0;font-size:34px;line-height:40px;font-weight:400;letter-spacing:-.035em;display:flex;align-items:center;gap:14px}
.head p.sub{margin-top:10px;font-size:14.5px;line-height:22px;color:var(--muted);max-width:62ch}
.head .acts{display:flex;align-items:center;gap:8px;flex:none}

/* sections: a ruled label, then content on the page itself */
.sec{margin-top:44px}
.head + .sec,.head + .note + .sec{margin-top:8px}
.sec-h{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.sec-h .label{color:var(--text-2)}
.sec-h .aside{font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:10px}
.sec-h .aside a{color:var(--text-2)}.sec-h .aside a:hover{color:var(--text)}
.sec-h .label{display:inline-flex;align-items:center}
.fold > summary{cursor:pointer;list-style:none;user-select:none}.fold > summary::-webkit-details-marker{display:none}
.fold > summary:hover .label{color:var(--text)}
.fold .chev{display:inline-flex;color:var(--muted);transition:transform .2s var(--ease)}.fold:not([open]) .chev{transform:rotate(-90deg)}
.fold:not([open]) > summary{border-bottom-color:var(--line)}
.sec-note{font-size:13px;color:var(--muted);padding:12px 0 0;max-width:70ch}

.strip{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.strip > div{flex:1;min-width:150px;padding:16px 18px;border-right:1px solid var(--line)}
.strip > div:last-child{border-right:0}
.strip .v{font-family:var(--mono);font-size:26px;line-height:32px;letter-spacing:-.04em;color:var(--text);margin-top:8px;font-variant-numeric:tabular-nums}
.strip .h{font-size:12.5px;color:var(--faint);margin-top:2px}

.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);padding:12px 14px 10px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:13px 14px 13px 0;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13.5px}
.tbl tbody tr{transition:background .1s}
.tbl tbody tr:hover{background:var(--hover)}
.tbl tr.link{cursor:pointer}
.tbl .m{font-family:var(--mono);font-size:12.5px;color:var(--text-2);white-space:nowrap;font-variant-numeric:tabular-nums}
.tbl .clip{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)}
.tbl .r{text-align:right;padding-right:0}
.who{display:flex;align-items:center;gap:10px;white-space:nowrap}
.who b{font-weight:500}
.who small{display:block;font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:1px}

.bar{display:inline-block;vertical-align:middle;width:88px;height:4px;border-radius:2px;background:var(--bg-3);overflow:hidden}
.bar > span{display:block;height:100%;background:var(--text-2)}
.bar.high > span{background:var(--warn)}.bar.full > span{background:var(--bad)}

.term{display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;min-height:42px;border:1px solid var(--line-2);border-radius:8px;background:var(--bg-1);min-width:0}
.term code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-size:12.5px}
.term .pr{color:var(--faint);margin-right:8px;user-select:none}
.term.ml{align-items:flex-start;padding:12px 6px 12px 14px}.term.ml code{white-space:pre;overflow:auto;line-height:19px}
.cp{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:6px;background:none;color:var(--muted);font-family:var(--mono);font-size:11.5px;cursor:pointer;flex:none}
.cp:hover{color:var(--text);background:var(--hover)}

.note{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border:1px solid var(--line-2);border-left:2px solid var(--muted);border-radius:8px;background:var(--bg-1)}
.note.bad{border-left-color:var(--bad)}.note.warn{border-left-color:var(--warn)}.note.ok{border-left-color:var(--ok)}
.note .grow{flex:1;min-width:0}.note b{font-weight:500}.note p{font-size:13px;color:var(--muted);margin-top:3px}

.empty{padding:40px 0;color:var(--muted);font-size:13.5px}
.empty b{display:block;color:var(--text);font-weight:500;margin-bottom:4px}
.empty code{color:var(--text-2)}

.kv{display:grid;grid-template-columns:170px 1fr;border-top:1px solid var(--line)}
.kv > div{padding:12px 0;border-bottom:1px solid var(--line);font-size:13.5px;min-width:0}
.kv .k{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);padding-top:14px}

.log{font-family:var(--mono);font-size:12.5px;line-height:20px}
.log > div{display:grid;grid-template-columns:76px 84px minmax(0,190px) minmax(0,1fr);gap:16px;padding:9px 0;border-bottom:1px solid var(--line);align-items:baseline}
.log .t{color:var(--faint)}.log .e{color:var(--text-2)}.log .e.ok{color:var(--ok)}.log .e.bad{color:var(--bad)}.log .e.q{color:var(--info)}
.log .to{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.log .b{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--sans);font-size:13px}

.seg{display:inline-flex;gap:0;border:1px solid var(--line-2);border-radius:999px;padding:2px}
.seg button,.seg a{height:26px;padding:0 12px;border:0;background:none;border-radius:999px;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;text-transform:lowercase}
.seg button:hover,.seg a:hover{color:var(--text)}
.seg .on{background:var(--bg-3);color:var(--text)}

.split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:56px;align-items:start}
@media (max-width:980px){.split{grid-template-columns:1fr;gap:28px}}
@media (max-width:760px){
  .top-in{padding:0 16px;gap:12px}.tabs{overflow-x:auto;margin-left:0}.top .ws .wn,.top .ws .sl{display:none}
  .wrap{padding:28px 16px 80px}.head{flex-direction:column;align-items:flex-start}.head h1{font-size:28px;line-height:34px}
  .kv{grid-template-columns:1fr}.kv .k{padding-bottom:0;border-bottom:0}
  .log > div{grid-template-columns:64px 1fr}.log .to,.log .b{grid-column:2}
  .strip > div{min-width:50%;border-bottom:1px solid var(--line)}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

const BOOT = `try{var t=localStorage.getItem("parley-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`

/** Behavior every page shares: theme toggle, copy buttons, tabs, the account menu, confirmations, row links. */
const SCRIPT = `
document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{const r=document.documentElement;const t=r.dataset.theme==='light'?'dark':'light';r.dataset.theme=t;try{localStorage.setItem('parley-theme',t)}catch(e){}}));
document.addEventListener('click',e=>{const m=document.querySelector('.me');if(m&&m.open&&!m.contains(e.target))m.open=false});
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);const s=b.querySelector('span');if(s){const t=s.textContent;s.textContent='copied';setTimeout(()=>s.textContent=t,1400)}}catch(e){}}));
document.querySelectorAll('[data-tabs]').forEach(t=>t.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(!b)return;const box=t.closest('[data-tabbox]')||document;t.querySelectorAll('button[data-tab]').forEach(x=>x.classList.toggle('on',x===b));box.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==b.dataset.tab)}));
document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}));
document.querySelectorAll('tr[data-href]').forEach(r=>r.addEventListener('click',e=>{if(!e.target.closest('a,button,form'))location.href=r.dataset.href}));
`

export function shell(title: string, body: string, opts: { css?: string; script?: string } = {}): string {
  return `<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><script>${BOOT}</script><title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0c0c0b"/><g transform="translate(11 9) scale(.68)"><path fill="#edebe4" fill-rule="evenodd" d="${MARK_PATH}"/></g></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
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
    return `<a class="tab${opts.active === id ? " on" : ""}" href="${href}"${opts.active === id ? ' aria-current="page"' : ""}>${label}${n ? `<span class="n">${n}</span>` : ""}</a>`
  }
  return shell(`${opts.title} · Parley`, `
    <header class="top"><div class="top-in">
      <div class="ws"><a href="/app">${LOGO}</a><span class="sl">/</span><span class="wn">${esc(user.name)}</span></div>
      <nav class="tabs">${tab("overview", "/app", "Overview")}${tab("outbox", "/app/outbox", "Outbox")}${tab("agents", "/app/agents", "Agents")}${SHOW_NETWORK ? tab("network", "/app/network", "Network") : ""}${tab("settings", "/app/settings", "Settings")}</nav>
      <div class="right">
        <button class="icon-btn" type="button" data-theme-toggle title="Toggle theme" aria-label="Toggle theme"><span class="th-l">${icon("sun", 15)}</span><span class="th-d">${icon("moon", 15)}</span></button>
        <details class="me"><summary aria-label="Account">${avatar(user, 26)}</summary>
          <div class="menu"><div class="mh"><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div>
            <a href="/app/settings">Settings</a>
            <form method="post" action="/auth/signout"><button type="submit">${icon("logout", 14)}Sign out</button></form></div>
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
