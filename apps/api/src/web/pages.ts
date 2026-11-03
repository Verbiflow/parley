import type { Connection } from "../sessions/store.ts"
import type { ChatRow } from "../sessions/chats.ts"

/** Real brand marks (simple-icons paths, 24×24), white on a solid brand tile. */
const BRANDS: Record<string, { name: string; bg: string; path: string; tagline: string; live: boolean }> = {
  whatsapp: {
    name: "WhatsApp", bg: "#25D366", live: true, tagline: "Message as your own number",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  telegram: {
    name: "Telegram", bg: "#229ED9", live: false, tagline: "Bots and DMs",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  instagram: {
    name: "Instagram", bg: "linear-gradient(135deg,#feda75,#fa7e1e 28%,#d62976 58%,#6228d7)", live: false, tagline: "DMs from Chrome",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  linkedin: {
    name: "LinkedIn", bg: "#0A66C2", live: false, tagline: "Messages and invites",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
}

function tile(id: string, size = 32): string {
  const b = BRANDS[id]!
  return `<span class="tile" style="background:${b.bg};width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.54)}" height="${Math.round(size * 0.54)}" fill="#fff" aria-hidden="true"><path d="${b.path}"/></svg></span>`
}

/** Parley's mark: a chat bubble whose tail forms the stem of a "P". Uses currentColor so it follows the theme. */
const MARK_PATH = "M16 26A20 20 0 1 1 28 44.33C26 50.5 21.5 55.5 16 58ZM36 18a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"
const MARK = `<svg viewBox="0 0 64 64" width="24" height="24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${MARK_PATH}"/></svg>`

const LOGO = `<span class="logo">${MARK}<span>Parley</span></span>`

/**
 * Flage's design tokens, copied from flage/frontend/app/globals.css: the neutral light theme (#FAFAFA page, white cards,
 * #171717 primary) and the warm-charcoal dark theme (cream primary on charcoal). `data-theme` on <html> picks one.
 */
const BASE_CSS = `
*{box-sizing:border-box}
:root{
  --bg:#fafafa;--surface:#fff;--surface-2:#f5f5f5;--surface-3:#ebebeb;--text:#1a1a1a;--text-2:#4a4a4a;--muted:#737373;
  --border:#ebebeb;--border-strong:#e5e5e5;--primary:#171717;--primary-hover:#262626;--primary-ink:#fff;
  --accent:#10b981;--success:#059669;--success-bg:#ecfdf5;--danger:#dc2626;--danger-bg:#fee2e2;--danger-border:#fca5a5;
  --focus:rgba(23,23,23,.08);--shadow:0 1px 2px rgba(0,0,0,.04);--shadow-pop:0 10px 15px -3px rgba(0,0,0,.05),0 4px 6px -2px rgba(0,0,0,.03);
  --radius:6px;--radius-lg:8px;--ease:cubic-bezier(.23,1,.32,1);
  --font:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  color-scheme:light;
}
[data-theme=dark]{
  --bg:hsl(18 12% 8%);--surface:hsl(20 12% 10%);--surface-2:hsl(20 12% 14%);--surface-3:hsl(20 10% 18%);
  --text:hsl(30 20% 93%);--text-2:hsl(28 12% 76%);--muted:hsl(25 10% 52%);
  --border:hsl(20 12% 16%);--border-strong:hsl(20 12% 20%);--primary:hsl(30 30% 90%);--primary-hover:hsl(30 26% 82%);--primary-ink:hsl(20 18% 9%);
  --accent:#34d399;--success:#34d399;--success-bg:rgba(16,185,129,.14);--danger:#f87171;--danger-bg:rgba(239,68,68,.12);--danger-border:rgba(239,68,68,.35);
  --focus:rgba(255,244,225,.1);--shadow:0 1px 2px rgba(0,0,0,.3);--shadow-pop:0 10px 24px rgba(0,0,0,.45),0 0 0 1px rgba(255,244,225,.04);
  color-scheme:dark;
}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-decoration:none}
.wrap{max-width:60rem;margin:0 auto;padding:0 1.5rem}
.logo{display:inline-flex;align-items:center;gap:.5rem;font-weight:600;letter-spacing:-.01em;font-size:15px}
.tile{display:inline-grid;place-items:center;border-radius:7px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.04)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;height:32px;padding:0 12px;font-family:inherit;font-size:13px;font-weight:500;border-radius:var(--radius);border:1px solid transparent;background:var(--primary);color:var(--primary-ink);cursor:pointer;transition:background .12s var(--ease),transform .12s var(--ease),border-color .12s var(--ease);white-space:nowrap}
.btn:hover{background:var(--primary-hover)}.btn:active{transform:scale(.97)}
.btn svg{width:15px;height:15px}
.btn.outline{background:var(--surface);border-color:var(--border-strong);color:var(--text)}.btn.outline:hover{background:var(--surface-2)}
.btn.sm{height:28px;padding:0 10px;font-size:12px}
.muted{color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:.3rem;height:22px;padding:0 8px;font-size:12px;font-weight:500;border-radius:6px;border:1px solid var(--border-strong);color:var(--muted);background:var(--surface)}
.badge.on{color:var(--success);border:0;background:var(--success-bg)}
.badge svg{width:12px;height:12px}
.input{width:100%;height:36px;padding:0 10px;border-radius:var(--radius);border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font:inherit;outline:none}
.input:focus{border-color:var(--muted);box-shadow:0 0 0 3px var(--focus)}
code{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--surface-2);border:1px solid var(--border);padding:.05em .3em;border-radius:4px}
`

const SHELL = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><script>try{var t=localStorage.getItem("parley-theme");document.documentElement.dataset.theme=t==="dark"||t==="light"?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}</script><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style></head><body>${body}</body></html>`

const waNumber = (h: string | null) => {
  const d = (h ?? "").split("@")[0]!.split(":")[0]!.replace(/\D/g, "")
  return d ? `+${d}` : "Connected"
}

export function landingPage(opts: { workos: boolean; dev: boolean }): string {
  const signin = opts.workos
    ? `<a class="btn" href="/auth/start" style="width:100%">Sign in to continue</a>`
    : `<div class="notice">Sign-in isn't configured. Set <code>WORKOS_CLIENT_ID</code> and <code>WORKOS_API_KEY</code>.</div>`
  const dev = opts.dev
    ? `<form method="post" action="/auth/dev" class="df">
         <input class="input" name="email" type="email" placeholder="you@example.com" required aria-label="email">
         <button class="btn outline" type="submit" style="width:100%">Continue with dev login</button></form>`
    : ""
  return SHELL(
    "Parley",
    `<style>
      .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.5rem;gap:14px}
      .hero h1{font-size:28px;line-height:34px;letter-spacing:-.02em;margin:6px 0 0;max-width:17ch;font-weight:600}
      .hero .sub{font-size:15px;line-height:22px;color:var(--text-2);max-width:42ch;margin:0}
      .tiles{display:flex;gap:8px;margin-top:4px}
      .panel{width:100%;max-width:340px;padding:18px;margin-top:8px;display:flex;flex-direction:column;gap:12px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow)}
      .df{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);padding-top:12px}
      .notice{font-size:13px;color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;text-align:left}
    </style>
    <main class="hero">
      ${LOGO}
      <h1>Your messaging, ready for your agents.</h1>
      <p class="sub">Link WhatsApp once. Your agents send and receive over MCP — you never hand them your phone.</p>
      <div class="tiles">${tile("whatsapp", 32)}${tile("telegram", 32)}${tile("instagram", 32)}${tile("linkedin", 32)}</div>
      <section class="panel">${signin}${dev}</section>
    </main>`
  )
}

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`

/** Escape text for HTML bodies and attribute values. Every user- or agent-supplied string goes through this. */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)

/** Lucide-style outline icons (24×24, stroke). */
const ICON = {
  plug: `<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>`,
  bot: `<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`,
  settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  moon: `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>`,
  chevrons: `<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  book: `<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>`,
  monitor: `<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>`,
  search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  back: `<path d="m15 18-6-6 6-6"/>`,
  user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>`,
}
const icon = (name: keyof typeof ICON, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`

export type Viewer = { name: string; email: string; image: string | null; signedInWith: string | null; createdAt: string }

function initials(name: string, email: string): string {
  const words = (name || email).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase()
}

/** The account's picture from the identity provider, or initials on a neutral disc. */
function avatar(u: Viewer, size = 28): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`
  if (u.image && /^https:\/\//.test(u.image)) return `<img class="av" src="${esc(u.image)}" alt="" referrerpolicy="no-referrer" style="${style}">`
  return `<span class="av av-i" style="${style}" aria-hidden="true">${esc(initials(u.name, u.email))}</span>`
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

const METHOD: Record<string, string> = { google: "Google", github: "GitHub", local: "Email (dev login)", proof: "Test account" }

function browserName(ua: string | null): string {
  if (!ua) return "Unknown browser"
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ""
  return os ? `${b} on ${os}` : b
}

const SHELL_CSS = `
.app{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:2px;padding:12px 10px;border-right:1px solid var(--border);background:var(--surface)}
.side .brand{padding:6px 8px 14px}
.nav-l{padding:10px 10px 4px;font-size:11px;font-weight:500;color:var(--muted)}
.nav{display:flex;align-items:center;gap:12px;height:32px;padding:0 10px;border-radius:var(--radius);color:var(--muted);font-weight:500;font-size:14px;transition:background .12s var(--ease),color .12s var(--ease)}
.nav:hover{background:var(--surface-2);color:var(--text)}
.nav.on{background:var(--surface-2);color:var(--text)}
.nav svg{color:var(--muted);flex:none}.nav.on svg{color:var(--text)}
.nav .count{margin-left:auto;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.side .grow{flex:1}
.nav.theme{border:0;background:none;font-family:inherit;cursor:pointer;width:100%;margin-bottom:4px}
.nav.theme > span{display:flex;align-items:center;gap:12px}
.th-d,[data-theme=dark] .th-l{display:none!important}[data-theme=dark] .th-d{display:flex!important}
.me{position:relative}
.me summary{list-style:none;display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--radius);cursor:pointer;transition:background .12s var(--ease)}
.me summary::-webkit-details-marker{display:none}
.me summary:hover,.me[open] summary{background:var(--surface-2)}
.me .who{flex:1;min-width:0;line-height:16px}
.me .who b{display:block;font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me .who span{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me summary > svg{color:var(--muted);flex:none}
.menu{position:absolute;bottom:calc(100% + 6px);left:0;right:0;padding:4px;border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow-pop);z-index:10}
.menu .mh{padding:8px 8px 10px;border-bottom:1px solid var(--border);margin-bottom:4px;line-height:16px}
.menu .mh b{display:block;font-weight:500;font-size:13px}.menu .mh span{font-size:12px;color:var(--muted);word-break:break-all}
.menu a,.menu button{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;background:none;border-radius:5px;font:inherit;font-size:13px;color:var(--text);cursor:pointer;text-align:left}
.menu a:hover,.menu button:hover{background:var(--surface-2)}
.menu svg{color:var(--muted)}
.av{border-radius:50%;object-fit:cover;flex:none;display:inline-block}
.av-i{display:inline-grid;place-items:center;background:var(--surface-3);color:var(--text-2);font-weight:600;letter-spacing:.01em}
.main{min-width:0;padding:28px 40px 64px}
.page{max-width:56rem}
.ph{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px}
.ph h1{font-size:20px;line-height:28px;letter-spacing:-.012em;font-weight:600;margin:0}
.ph p{margin:2px 0 0;color:var(--muted);font-size:13px}
.sec{margin:28px 0 10px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.sec .btn{text-transform:none;letter-spacing:0}
.card{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.rows > *{display:flex;align-items:center;gap:12px;padding:12px 16px}
.rows > * + *{border-top:1px solid var(--border)}
.rows .grow{flex:1;min-width:0}
.rows .t{margin:0;font-weight:500}.rows .s{margin:1px 0 0;font-size:12px;color:var(--muted)}
.ico{width:32px;height:32px;border-radius:7px;display:grid;place-items:center;background:var(--surface-2);color:var(--text-2);flex:none}
.empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px}
.url{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface-2);min-width:0}
.url code{flex:1;min-width:0;background:none;border:0;padding:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn.ghost{background:none;color:var(--text-2);border-color:transparent}.btn.ghost:hover{background:var(--surface-2);color:var(--text)}
.btn.danger{background:var(--surface);color:var(--danger);border-color:var(--border-strong)}.btn.danger:hover{background:var(--danger-bg);border-color:var(--danger-border)}
.kv{display:grid;grid-template-columns:160px 1fr;gap:0}
.kv > div{padding:12px 16px;border-top:1px solid var(--border)}
.kv > div:nth-child(-n+2){border-top:0}
.kv .k{color:var(--muted);font-size:13px}
.tag{display:inline-flex;align-items:center;height:20px;padding:0 7px;font-size:11px;font-weight:500;border-radius:5px;background:var(--success-bg);color:var(--success)}
@media (max-width:760px){
  .app{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;border-right:0;border-bottom:1px solid var(--border)}
  .side .brand{padding:6px 8px}.nav-l,.side .grow,.me .who,.nav.theme span span{display:none}
  .me{margin-left:auto}.menu{left:auto;right:0;bottom:auto;top:calc(100% + 6px);width:240px}
  .main{padding:20px 16px 48px}
  .kv{grid-template-columns:1fr}.kv > div:nth-child(odd){padding-bottom:0;border-top:1px solid var(--border)}.kv > div:nth-child(even){border-top:0;padding-top:2px}
}
`

type Section = "connectors" | "agents" | "settings"

/** The signed-in app frame: a left sidebar (brand, navigation, account menu) around the page body. */
function appShell(opts: { title: string; active: Section; user: Viewer; agentCount?: number; css?: string; body: string }): string {
  const { user } = opts
  const nav = (id: Section, href: string, label: string, ic: keyof typeof ICON, extra = "") =>
    `<a class="nav${opts.active === id ? " on" : ""}" href="${href}"${opts.active === id ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${extra}</a>`
  return SHELL(
    `${opts.title} · Parley`,
    `<style>${SHELL_CSS}${opts.css ?? ""}</style>
    <div class="app">
      <aside class="side">
        <a class="brand" href="/app">${LOGO}</a>
        <div class="nav-l">Workspace</div>
        ${nav("connectors", "/app", "Connectors", "plug")}
        ${nav("agents", "/app/agents", "Agents", "bot", opts.agentCount ? `<span class="count">${opts.agentCount}</span>` : "")}
        <div class="nav-l">Account</div>
        ${nav("settings", "/app/settings", "Settings", "settings")}
        <div class="grow"></div>
        <button class="nav theme" type="button" id="theme"><span class="th-l">${icon("moon")}<span>Dark mode</span></span><span class="th-d">${icon("sun")}<span>Light mode</span></span></button>
        <details class="me">
          <summary>${avatar(user, 28)}<span class="who"><b>${esc(user.name)}</b><span>${esc(user.email)}</span></span>${icon("chevrons", 14)}</summary>
          <div class="menu">
            <div class="mh"><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div>
            <a href="/app/settings">${icon("settings", 15)}Settings</a>
            <form method="post" action="/auth/signout"><button type="submit">${icon("logout", 15)}Sign out</button></form>
          </div>
        </details>
      </aside>
      <main class="main"><div class="page">${opts.body}</div></main>
    </div>
    <script>
      document.getElementById('theme').addEventListener('click',()=>{const r=document.documentElement;const t=r.dataset.theme==='dark'?'light':'dark';r.dataset.theme=t;try{localStorage.setItem('parley-theme',t)}catch(e){}});
      document.addEventListener('click',e=>{const m=document.querySelector('.me');if(m&&m.open&&!m.contains(e.target))m.open=false});
      document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);const t=b.innerHTML;b.textContent='Copied';setTimeout(()=>b.innerHTML=t,1400)}catch(e){}}));
    </script>`
  )
}

function mcpBox(url: string): string {
  return `<div class="url"><code>${esc(url)}</code><button class="btn sm outline" type="button" data-copy="${esc(url)}">${icon("copy", 13)}Copy</button></div>`
}

function connectorCard(id: string, conn: Connection | undefined, synced?: number): string {
  const b = BRANDS[id]!
  let left = ""
  let right = ""
  let desc = b.tagline
  if (!b.live) {
    right = `<span class="badge">Soon</span>`
  } else if (conn?.status === "connected") {
    desc = `${waNumber(conn.handle)}${conn.displayName ? ` · ${esc(conn.displayName)}` : ""}`
    left = `<span class="badge on">${CHECK}Connected</span>`
    const chats = conn.chatsChosen
      ? `<a class="btn sm outline" href="/app/connections/${esc(conn.id)}/chats">${synced ?? 0} chat${synced === 1 ? "" : "s"} synced</a>`
      : `<a class="btn sm" href="/app/connections/${esc(conn.id)}/chats">Choose chats</a>`
    right = `<span class="cc-acts">${chats}<form method="post" action="/app/connections/${esc(conn.id)}/disconnect" onsubmit="return confirm('Disconnect ${b.name}? Your agents will lose access to it.')"><button class="btn sm ghost" type="submit">Disconnect</button></form></span>`
  } else if (conn && (conn.status === "linking" || conn.status === "closed")) {
    left = `<span class="badge">Waiting for scan</span>`
    right = `<a class="btn sm outline" href="/link/${esc(conn.id)}">Finish linking</a>`
  } else {
    left = `<span class="badge">Not connected</span>`
    right = `<form method="post" action="/app/connect"><button class="btn sm" type="submit">Connect</button></form>`
  }
  return `<article class="cc${b.live ? "" : " soon"}">
    <div class="cc-row">${tile(id, 32)}<div class="cc-info"><p class="cc-name">${b.name}</p><p class="cc-desc">${desc}</p></div></div>
    <div class="cc-foot">${left}${right}</div>
  </article>`
}

const CARD_CSS = `
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:12px}
.cc{display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.cc.soon{opacity:.7}
.cc-row{display:flex;align-items:center;gap:10px;min-width:0}
.cc-info{flex:1;min-width:0}
.cc-name{margin:0;font-weight:500;font-size:14px}
.cc-desc{margin:1px 0 0;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}
.cc-acts{display:inline-flex;align-items:center;gap:4px}
.cc-foot:has(.badge:only-child),.cc.soon .cc-foot{justify-content:flex-end}
.hook{display:flex;align-items:center;gap:16px;padding:16px}
.hook .grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.hook .t{margin:0;font-weight:500}.hook .s{margin:0;font-size:12px;color:var(--muted)}
@media (max-width:760px){.hook{flex-direction:column;align-items:stretch}}
`

const GUIDE_CSS = `
.guide{padding:0}
.guide > summary{list-style:none;display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none}
.guide > summary::-webkit-details-marker{display:none}
.guide > summary .t{flex:1;margin:0;font-weight:500}
.guide > summary .chev{display:flex;color:var(--muted);transition:transform .15s var(--ease)}.guide[open] > summary .chev{transform:rotate(180deg)}
.guide .gb{padding:0 16px 16px;display:flex;flex-direction:column;gap:10px}
.guide .s{margin:0;font-size:13px;color:var(--text-2)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-top:2px}
.tabs button{height:30px;padding:0 10px;border:0;background:none;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button.on{color:var(--text);border-bottom-color:var(--text)}
.pane{display:none;flex-direction:column;gap:8px;font-size:13px;color:var(--text-2)}.pane.on{display:flex}
.pane ol{margin:0;padding-left:18px}.pp{margin:0}.pane li{margin:2px 0}
pre.cmd{margin:0;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface-2);font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}
pre.cmd code{flex:1;background:none;border:0;padding:0}
.note{font-size:12px;color:var(--muted);margin:0}
.agent-line{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
`

function cmdBox(text: string): string {
  return `<pre class="cmd"><code>${esc(text)}</code><button class="btn sm outline" type="button" data-copy="${esc(text)}">${icon("copy", 13)}Copy</button></pre>`
}

export function dashboardPage(opts: { user: Viewer; connections: Connection[]; agents: AgentView[]; mcpUrl: string; syncedCounts?: Map<string, number> }): string {
  const byChannel = new Map<string, Connection>()
  for (const c of opts.connections) if (!byChannel.has(c.channel)) byChannel.set(c.channel, c)
  const available = Object.keys(BRANDS).filter((id) => BRANDS[id]!.live).map((id) => { const c = byChannel.get(id); return connectorCard(id, c, c && opts.syncedCounts?.get(c.id)) }).join("")
  const soon = Object.keys(BRANDS).filter((id) => !BRANDS[id]!.live).map((id) => connectorCard(id, undefined)).join("")
  const first = esc(opts.user.name.split(/\s+/)[0] ?? "")

  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(opts.mcpUrl)

  const active = opts.agents.filter(isActive)
  const agentLine = opts.agents.length
    ? `<div class="agent-line">${active.length ? liveDot.replace('margin-left:6px', '') : icon("bot", 14)}<span>${active.length
        ? `<b>${esc(active[0]!.clientName || "An agent")}</b> is using Parley right now${active.length > 1 ? ` (+${active.length - 1} more)` : ""}`
        : `${opts.agents.length} agent${opts.agents.length === 1 ? "" : "s"} authorized · ${opts.agents[0]!.lastUsedAt ? `last used ${ago(opts.agents[0]!.lastUsedAt)}` : "not used yet"}`}
        · <a href="/app/agents" style="text-decoration:underline">see agents</a></span></div>`
    : ""

  const chevDown = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`
  const guide = `<details class="card guide" id="add-ai"${opts.agents.length ? "" : " open"}>
    <summary><p class="t">Add Parley to your AI</p><span class="chev">${chevDown}</span></summary>
    <div class="gb">
    <p class="s">Parley is an MCP server. Add this URL to your AI app. It opens a browser to sign in with this account (no API key).</p>
    ${mcpBox(opts.mcpUrl)}
    <div class="tabs" role="tablist"><button type="button" class="on" data-tab="cc">Claude Code</button><button type="button" data-tab="cd">Claude app</button><button type="button" data-tab="cx">Codex</button><button type="button" data-tab="gpt">ChatGPT</button><button type="button" data-tab="cu">Cursor</button><button type="button" data-tab="ot">Other</button></div>
    <div class="pane on" data-pane="cc"><p class="pp">Run this in a terminal. Then start <code>claude</code> and type <code>/mcp</code> to sign in.</p>${cmdBox(`claude mcp add --transport http parley ${opts.mcpUrl}`)}</div>
    <div class="pane" data-pane="cd"><ol><li>Open <b>Settings → Connectors</b></li><li><b>Add custom connector</b>, name it Parley, and paste the URL above</li><li>Click <b>Connect</b> and sign in</li></ol>
      ${local ? `<p class="note">The Claude app connects from Anthropic's servers, so it needs a public URL. This server is local (${esc(opts.mcpUrl)}): use Claude Code or Cursor, or expose it with a tunnel and set <code>PUBLIC_URL</code>.</p>` : ""}</div>
    <div class="pane" data-pane="cx"><p class="pp">Run this in a terminal, then sign in with <code>codex mcp login parley</code>.</p>${cmdBox(`codex mcp add parley --url ${opts.mcpUrl}`)}</div>
    <div class="pane" data-pane="gpt"><ol><li>Open <b>Settings → Apps &amp; Connectors → Advanced settings</b> and turn on <b>Developer mode</b></li><li>Back in <b>Apps &amp; Connectors</b>, click <b>Create</b>, name it Parley, paste the URL above, and pick <b>OAuth</b></li><li>Click <b>Create</b> and sign in</li></ol>
      ${local ? `<p class="note">ChatGPT connects from OpenAI's servers, so it needs a public URL. This server is local (${esc(opts.mcpUrl)}): use Codex, Claude Code or Cursor, or expose it with a tunnel and set <code>PUBLIC_URL</code>.</p>` : ""}</div>
    <div class="pane" data-pane="cu"><p class="pp">Add this to <code>~/.cursor/mcp.json</code>, then turn on Parley under <b>Settings → MCP</b>.</p>${cmdBox(JSON.stringify({ mcpServers: { parley: { url: opts.mcpUrl } } }, null, 2))}</div>
    <div class="pane" data-pane="ot"><p class="pp">Any MCP client that supports remote servers (Streamable HTTP + OAuth) works. Add the URL above as a remote server and it finds the sign-in on its own.</p></div>
    ${agentLine}
    </div>
  </details>
  <script>(()=>{const d=document.getElementById('add-ai'),k='parley.addAi';const v=localStorage.getItem(k);if(v)d.open=v==='open';d.addEventListener('toggle',()=>localStorage.setItem(k,d.open?'open':'closed'))})()</script>
  <script>document.querySelectorAll('.tabs').forEach(t=>t.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const box=t.parentElement;box.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));box.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.dataset.pane===b.dataset.tab))}))</script>`

  return appShell({
    title: "Connectors", active: "connectors", user: opts.user, agentCount: opts.agents.length, css: CARD_CSS + GUIDE_CSS + LIVE_CSS,
    body: `<div class="ph"><div><h1>Connectors</h1><p>${first ? `Welcome back, ${first}. ` : ""}Link a messaging account. Your agents use it over MCP.</p></div></div>
      ${guide}
      <div class="sec">Available</div>
      <div class="grid">${available}</div>
      <div class="sec">Coming soon</div>
      <div class="grid">${soon}</div>`,
  })
}

export type AgentView = {
  sessionId: string; clientName: string | null; clientId: string; connectedAt: string; lastRefreshedAt: string
  lastUsedAt: string | null; lastTool: string | null; lastToolAt: string | null; calls: number
}

/** An agent counts as "active now" if it called Parley in the last two minutes. */
const isActive = (a: AgentView) => Boolean(a.lastUsedAt && Date.now() - Date.parse(a.lastUsedAt) < 120_000)
const TOOL_LABEL: Record<string, string> = {
  read_inbox: "read your inbox", list_chats: "listed your chats", send_message: "sent a message", connect: "started linking a channel",
  connection_status: "checked a connection", list_connections: "listed connections", list_channels: "listed channels",
}
function activity(a: AgentView): string {
  if (!a.lastUsedAt) return `Authorized ${ago(a.connectedAt)} · hasn't used Parley yet`
  const did = a.lastTool ? ` · last ${esc(TOOL_LABEL[a.lastTool] ?? a.lastTool)}${a.lastToolAt ? ` ${ago(a.lastToolAt)}` : ""}` : ""
  return `${isActive(a) ? "Using Parley right now" : `Last active ${ago(a.lastUsedAt)}`}${did} · ${a.calls} tool call${a.calls === 1 ? "" : "s"}`
}
const liveDot = `<span class="live" title="Active in the last 2 minutes"></span>`
const LIVE_CSS = `.live{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--success-bg);margin-left:6px;vertical-align:middle;animation:pulse 2s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}`

export function agentsPage(opts: { user: Viewer; agents: AgentView[]; mcpUrl: string }): string {
  const rows = opts.agents.length
    ? opts.agents.map((a) => `<div>
        <span class="ico">${icon("bot", 16)}</span>
        <div class="grow"><p class="t">${esc(a.clientName || "Unnamed MCP client")}${isActive(a) ? liveDot : ""}</p><p class="s">${activity(a)}</p></div>
        <form method="post" action="/app/agents/${esc(a.sessionId)}/disconnect" onsubmit="return confirm('Disconnect this agent? It will need to sign in again.')"><button class="btn sm danger" type="submit">Disconnect</button></form>
      </div>`).join("")
    : `<div class="empty" style="display:block">No agents connected yet. Add the URL above to an MCP client to get started.</div>`
  return appShell({
    title: "Agents", active: "agents", user: opts.user, agentCount: opts.agents.length, css: LIVE_CSS,
    body: `<div class="ph"><div><h1>Agents</h1><p>Apps and agents you've authorized to use your connectors.</p></div></div>
      <div class="sec" style="margin-top:0">MCP server URL</div>
      <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">${mcpBox(opts.mcpUrl)}
        <p class="muted" style="margin:0;font-size:12px">Add it as a remote MCP server. The client opens a browser to sign in with this account — no API key to paste.</p></section>
      <div class="sec">Authorized</div>
      <section class="card rows">${rows}</section>`,
  })
}

export type BrowserSessionView = { id: string; method: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }

export function settingsPage(opts: { user: Viewer; sessions: BrowserSessionView[]; currentSessionId: string }): string {
  const u = opts.user
  const sessions = opts.sessions.map((s) => {
    const here = s.id === opts.currentSessionId
    return `<div>
      <span class="ico">${icon("monitor", 16)}</span>
      <div class="grow"><p class="t">${esc(browserName(s.userAgent))} ${here ? `<span class="tag">This browser</span>` : ""}</p>
        <p class="s">Signed in ${ago(s.createdAt)}${s.method ? ` with ${esc(METHOD[s.method] ?? s.method)}` : ""} · last active ${ago(s.lastSeenAt)}</p></div>
      <form method="post" action="/app/settings/sessions/${esc(s.id)}/end"><button class="btn sm ${here ? "outline" : "ghost"}" type="submit">${here ? "Sign out" : "Revoke"}</button></form>
    </div>`
  }).join("")
  const others = opts.sessions.length > 1
    ? `<form method="post" action="/app/settings/sessions/end-others"><button class="btn sm outline" type="submit">Sign out other sessions</button></form>`
    : ""
  return appShell({
    title: "Settings", active: "settings", user: u,
    css: `.prof{display:flex;align-items:center;gap:14px;padding:16px;border-bottom:1px solid var(--border)}.prof b{display:block;font-size:15px;font-weight:600}.prof span{color:var(--muted);font-size:13px}`,
    body: `<div class="ph"><div><h1>Settings</h1><p>Your Parley account and where you're signed in.</p></div></div>
      <div class="sec" style="margin-top:0">Profile</div>
      <section class="card">
        <div class="prof">${avatar(u, 48)}<div><b>${esc(u.name)}</b><span>${esc(u.email)}</span></div></div>
        <div class="kv">
          <div class="k">Name</div><div>${esc(u.name)}</div>
          <div class="k">Email</div><div>${esc(u.email)}</div>
          <div class="k">Signed in with</div><div>${esc(METHOD[u.signedInWith ?? ""] ?? "—")}</div>
          <div class="k">Member since</div><div>${day(u.createdAt)}</div>
        </div>
      </section>
      <p class="muted" style="font-size:12px;margin:8px 2px 0">Your name and picture come from your sign-in provider.</p>
      <div class="sec" style="display:flex;align-items:center;justify-content:space-between">Active sessions ${others}</div>
      <section class="card rows">${sessions || `<div class="empty" style="display:block">No active sessions.</div>`}</section>
      <div class="sec">Security</div>
      <section class="card rows"><div><span class="ico">${icon("shield", 16)}</span><div class="grow"><p class="t">Your messages stay yours</p>
        <p class="s">Channel credentials are encrypted at rest. Agents only get access you authorize, and you can disconnect any of them from <a href="/app/agents" style="text-decoration:underline">Agents</a>.</p></div></div></section>`,
  })
}

/** The link page: shows the channel's QR, live-polls, and flips to a success state once connected. */
export function linkPage(id: string): string {
  return SHELL(
    "Link a channel · Parley",
    `<style>
      .lm{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.5rem;gap:12px}
      .lcard{width:100%;max-width:330px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow)}
      .qr{width:236px;height:236px;background:#fff;border:1px solid var(--border);border-radius:var(--radius);display:grid;place-items:center;padding:10px}
      .qr svg{width:100%;height:100%;display:block}
      .step{font-size:14px;color:var(--text-2);max-width:30ch;margin:0}
      .spin{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--border);border-top-color:var(--accent);animation:sp .8s linear infinite}
      @keyframes sp{to{transform:rotate(360deg)}}
      .ok{width:48px;height:48px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:24px}
      h1.lh{font-size:20px;line-height:28px;letter-spacing:-.01em;margin:4px 0 0;font-weight:600}
      ol.ol{text-align:left;color:var(--text-2);font-size:13px;margin:2px 0 0;padding-left:18px}
      ol.ol li{margin:3px 0}ol.ol b{color:var(--text);font-weight:600}
    </style>
    <main class="lm">
      ${LOGO}
      <h1 class="lh" id="title">Link your account</h1>
      <section class="lcard" id="card"><div class="spin"></div><p class="step">Preparing a secure link…</p></section>
    </main>
    <script>
      const id=${JSON.stringify(id)};const card=document.getElementById('card');const title=document.getElementById('title');
      function render(d){
        if(d.status==='connected'){title.textContent='Connected';card.innerHTML='<div class="ok">✓</div><p class="step"><b>'+((d.channel||'Channel').replace(/^./,x=>x.toUpperCase()))+' is linked.</b> Next, choose which chats your agents can see. Nothing is synced until you do.</p><a class="btn" style="width:100%" href="'+d.chats_url+'">Choose chats</a>';return true}
        if(d.qr_svg){title.textContent='Scan to link';card.innerHTML='<div class="qr">'+d.qr_svg+'</div><ol class="ol"><li>Open WhatsApp on your phone</li><li>Settings → <b>Linked devices</b></li><li><b>Link a device</b>, then scan this code</li></ol>';return false}
        card.innerHTML='<div class="spin"></div><p class="step">Preparing a secure link…</p>';return false
      }
      async function tick(){try{const r=await fetch('/link/'+id+'/status');if(r.ok){if(render(await r.json()))return}}catch(e){}setTimeout(tick,2000)}
      tick();
    </script>`
  )
}

const CHATS_CSS = `
.back{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:13px;margin-bottom:10px}.back:hover{color:var(--text)}
.tools{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.search{position:relative;flex:1;min-width:200px}.search svg{position:absolute;left:10px;top:10px;color:var(--muted)}
.search .input{padding-left:32px}
.seg{display:inline-flex;padding:2px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface-2)}
.seg button{height:30px;padding:0 10px;border:0;background:none;border-radius:5px;font:inherit;font-size:13px;color:var(--muted);cursor:pointer}
.seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.chats{max-height:calc(100vh - 290px);min-height:200px;overflow:auto}
.chat{cursor:pointer;user-select:none;transition:background .1s var(--ease)}.chat:hover{background:var(--surface-2)}
.chat input{position:absolute;opacity:0;pointer-events:none}
.box{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--border-strong);display:grid;place-items:center;flex:none;color:transparent;transition:all .12s var(--ease)}
.box svg{width:12px;height:12px}
.chat:has(input:checked) .box{background:var(--primary);border-color:var(--primary);color:var(--primary-ink)}
.cav{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--surface-3);color:var(--text-2);font-weight:600;font-size:12px}
.cav.g{border-radius:9px}
.chat .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat .when{font-size:12px;color:var(--muted);white-space:nowrap}
.bar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;margin-top:12px;padding:12px 16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow-pop)}
.bar .grow{flex:1;color:var(--text-2);font-size:13px}
.saved{padding:10px 14px;margin-bottom:12px;border-radius:var(--radius);background:var(--success-bg);color:var(--success);font-size:13px;font-weight:500}
.none{display:none!important}
`

/** "+15551234567" from a WhatsApp JID, or "" for ids that carry no number (groups, @lid). */
const phoneOf = (id: string) => (/@s\.whatsapp\.net$/.test(id) ? `+${id.split("@")[0]!.split(":")[0]}` : "")

/**
 * Choose which chats sync. Every chat the channel reported is listed (people and groups, most recent first); the
 * person ticks the ones agents may read. Searching/filtering is client-side; the form posts every checked id.
 */
export function chatsPage(opts: { user: Viewer; connection: Connection; chats: ChatRow[]; agentCount: number; saved: boolean }): string {
  const { connection: conn, chats } = opts
  const b = BRANDS[conn.channel]
  const rows = chats.map((c) => {
    const label = c.name || phoneOf(c.id) || (c.kind === "group" ? "Unnamed group" : "Unknown contact")
    const sub = c.kind === "group" ? "Group" : c.name ? phoneOf(c.id) || "Contact" : "Contact"
    const search = `${label} ${phoneOf(c.id)}`.toLowerCase()
    return `<label class="chat" data-kind="${c.kind}" data-q="${esc(search)}">
      <input type="checkbox" name="chat" value="${esc(c.id)}"${c.synced ? " checked" : ""}>
      <span class="box">${CHECK}</span>
      <span class="cav${c.kind === "group" ? " g" : ""}">${c.kind === "group" ? icon("users", 15) : c.name ? esc(initials(c.name, "")) : icon("user", 15)}</span>
      <div class="grow"><p class="t">${esc(label)}</p><p class="s">${esc(sub)}</p></div>
      ${c.lastMessageAt ? `<span class="when">${ago(c.lastMessageAt)}</span>` : ""}
    </label>`
  }).join("")
  const empty = `<div class="empty" style="display:block"><div class="spin" style="margin:0 auto 10px"></div>Loading your chats from ${b?.name ?? "the channel"}… this can take a minute after linking.</div>`
  return appShell({
    title: "Choose chats", active: "connectors", user: opts.user, agentCount: opts.agentCount,
    css: CHATS_CSS + `.spin{width:22px;height:22px;border-radius:50%;border:2.5px solid var(--border);border-top-color:var(--accent);animation:sp .8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`,
    body: `<a class="back" href="/app">${icon("back", 14)}Connectors</a>
      <div class="ph"><div><h1>Choose what to sync</h1><p>Your agents can only read the chats you pick${b ? ` on ${b.name}` : ""}${conn.handle ? ` (${esc(waNumber(conn.handle))})` : ""}. Unticking a chat deletes what Parley stored from it.</p></div></div>
      ${opts.saved ? `<div class="saved">Saved. Your agents now see only the chats ticked below.</div>` : ""}
      ${chats.length ? `<form method="post" id="f">
        <div class="tools">
          <div class="search">${icon("search", 15)}<input class="input" id="q" type="search" placeholder="Search people and groups" autocomplete="off"></div>
          <div class="seg" id="seg"><button type="button" class="on" data-f="all">All</button><button type="button" data-f="direct">People</button><button type="button" data-f="group">Groups</button><button type="button" data-f="on">Selected</button></div>
        </div>
        <section class="card rows chats" id="list">${rows}<div class="empty none" id="nomatch">No chats match.</div></section>
        <div class="bar"><span class="grow" id="count"></span>
          <button class="btn sm ghost" type="button" id="all">Select shown</button>
          <button class="btn sm ghost" type="button" id="clear">Clear shown</button>
          <button class="btn" type="submit">Save</button></div>
      </form>
      <script>
        const list=document.getElementById('list'),q=document.getElementById('q'),count=document.getElementById('count');let f='all';
        const rows=[...list.querySelectorAll('.chat')];
        const shown=()=>rows.filter(r=>!r.classList.contains('none'));
        function apply(){const t=q.value.trim().toLowerCase();let n=0;for(const r of rows){const on=r.querySelector('input').checked;const ok=(f==='all'||(f==='on'?on:r.dataset.kind===f))&&(!t||r.dataset.q.includes(t));r.classList.toggle('none',!ok);if(ok)n++}document.getElementById('nomatch').classList.toggle('none',n>0);tally()}
        function tally(){const n=rows.filter(r=>r.querySelector('input').checked).length;count.textContent=n?n+' of '+rows.length+' chat'+(rows.length===1?'':'s')+' selected':'Nothing selected — agents won\u2019t see any chats'}
        q.addEventListener('input',apply);list.addEventListener('change',tally);
        document.getElementById('seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;f=b.dataset.f;document.querySelectorAll('#seg button').forEach(x=>x.classList.toggle('on',x===b));apply()});
        document.getElementById('all').onclick=()=>{shown().forEach(r=>r.querySelector('input').checked=true);tally()};
        document.getElementById('clear').onclick=()=>{shown().forEach(r=>r.querySelector('input').checked=false);tally()};
        tally();
      </script>` : `<section class="card">${empty}</section><script>setTimeout(()=>location.reload(),3000)</script>`}`,
  })
}

/** "Allow <agent> to use your Parley account?" — shown when an MCP client signs in. Posts back to /oauth/authorize. */
export function consentPage(opts: { clientName: string | null; redirectUri: string; email: string; fields: Record<string, string> }): string {
  const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope"]
    .filter((k) => opts.fields[k] != null)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(opts.fields[k])}">`)
    .join("")
  let host = ""
  try { host = new URL(opts.redirectUri).host } catch {}
  const name = opts.clientName || "An MCP client"
  return SHELL(
    "Allow access · Parley",
    `<style>
      .lm{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1.5rem;gap:14px;text-align:center}
      .lcard{width:100%;max-width:380px;padding:22px;display:flex;flex-direction:column;gap:14px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow);text-align:left}
      h1{font-size:20px;line-height:28px;margin:0;font-weight:600;letter-spacing:-.01em;text-align:center}
      .who{font-size:13px;color:var(--muted);text-align:center;margin:-6px 0 0}
      ul{margin:0;padding-left:18px;color:var(--text-2);font-size:13px}li{margin:4px 0}
      .acts{display:flex;gap:8px}.acts .btn{flex:1;height:36px}
      .fine{font-size:12px;color:var(--muted);margin:0}
    </style>
    <main class="lm">${LOGO}
      <h1>Allow ${esc(name)} to use Parley?</h1>
      <p class="who">Signed in as <b>${esc(opts.email)}</b></p>
      <form class="lcard" method="post" action="/oauth/authorize">${hidden}
        <p style="margin:0;font-size:13px;color:var(--text)">It will be able to:</p>
        <ul><li>Read messages in the chats you chose to sync</li><li>Send messages from your connected accounts</li><li>Start linking a new account (you still scan the QR)</li></ul>
        <div class="acts"><button class="btn outline" type="submit" name="decision" value="deny">Cancel</button><button class="btn" type="submit" name="decision" value="allow">Allow</button></div>
        <p class="fine">${host ? `Returns to <code>${esc(host)}</code>. ` : ""}You can disconnect it any time from Agents in your dashboard.</p>
      </form>
    </main>`
  )
}
