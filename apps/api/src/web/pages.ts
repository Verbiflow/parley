import { parsePhoneNumberFromString } from "libphonenumber-js"
import type { Connection } from "../sessions/store.ts"
import type { ChatRow } from "../sessions/chats.ts"
import { UNSEND_WINDOW_MS, type DailyUsage, type Outbound } from "../sessions/outbox.ts"
import type { Exit, Provider } from "../sessions/exits.ts"
import {
  CHANNELS, LOGO, agentMark, ago, appShell, avatar, bar, brandMark, channelMark, channelName, clock, copyLine, day, empty, esc, glyph, icon,
  foldSection, mark, pageHead, section, shell, SHOW_NETWORK, stamp, status, until, type Tone, type Viewer,
} from "./ui.ts"

export type { Viewer } from "./ui.ts"

export type AgentView = {
  sessionId: string; clientName: string | null; clientId: string; connectedAt: string; lastRefreshedAt: string
  lastUsedAt: string | null; lastTool: string | null; lastToolAt: string | null; calls: number
}
export type BrowserSessionView = { id: string; method: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }
/** What the overview shows about a connection's sending: today's usage, what's waiting, and when the next one goes. */
export type ConnectionSummary = { sentToday: number; dailyLimit: number; queued: number; nextAt: string | null }

const METHOD: Record<string, string> = { google: "Google", github: "GitHub", local: "Email (dev login)", proof: "Test account" }
const KIND_LABEL: Record<string, string> = { message: "reply", first_message: "opener", invite: "invite" }
const HALT_TEXT: Record<string, string> = {
  challenge: "WhatsApp asked the account to verify itself. Open WhatsApp on the phone, clear any prompt, then resume.",
  auth_expired: "The linked session stopped working. Relink the device, then resume.",
  banned: "WhatsApp restricted this account. Sending is stopped for good on this number.",
}

/** "+44 7700 900123", the way people write their own number. */
const pretty = (e164: string) => parsePhoneNumberFromString(e164)?.formatInternational() ?? e164
const waNumber = (h: string | null) => {
  const d = (h ?? "").split("@")[0]!.split(":")[0]!.replace(/\D/g, "")
  return d ? pretty(`+${d}`) : ""
}
/** "+1 555 123 4567" from a WhatsApp JID, or "" for ids that carry no number (groups, @lid). */
const phoneOf = (id: string) => (/@s\.whatsapp\.net$/.test(id) ? pretty(`+${id.split("@")[0]!.split(":")[0]}`) : "")
const recipient = (to: string) => phoneOf(to) || (/^\+?[\d\s()-]{6,}$/.test(to) ? pretty(`+${to.replace(/\D/g, "")}`) : to)

function browserName(ua: string | null): string {
  if (!ua) return "Unknown browser"
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ""
  return os ? `${b} on ${os}` : b
}

function connectionState(c: Connection): { tone: Tone; text: string; live?: boolean } {
  if (c.status === "connected" && c.haltedReason) return { tone: "bad", text: "halted" }
  if (c.status === "connected" && c.pausedUntil) return { tone: "warn", text: "backing off" }
  if (c.status === "connected") return { tone: "ok", text: "live", live: true }
  if (c.status === "linking" || c.status === "closed") return { tone: "info", text: "waiting for scan" }
  if (c.status === "logged_out") return { tone: "idle", text: "disconnected" }
  return { tone: "bad", text: "error" }
}

function outcome(m: Outbound): string {
  if (m.status === "sent") return status("ok", "sent")
  if (m.status === "failed") return `<span title="${esc(m.error?.message)}">${status("bad", m.error?.code === "outcome_unknown" ? "interrupted" : m.error?.code === "recipient_unavailable" ? "not on whatsapp" : m.error?.code ?? "failed")}</span>`
  if (m.status === "canceled") return status("idle", "canceled")
  return status("info", "sending", true)
}

// ---- Signed out ---------------------------------------------------------------------------------------------------

/** Google's "G" mark, for the sign-in button (sign-in goes straight to Google; see /auth/start). */
const GOOGLE_G = `<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style="margin-right:8px;vertical-align:-3px"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`

/** The app's signed-out page (app.itsparley.com): one centered panel, straight to Google. */
export function landingPage(opts: { workos: boolean; dev: boolean }): string {
  const signin = opts.workos
    ? `<a class="btn lg block" href="/auth/start">${GOOGLE_G}Continue with Google</a>`
    : `<div class="note warn"><div class="grow"><b>Sign-in isn't configured</b><p>Set <code>WORKOS_CLIENT_ID</code> and <code>WORKOS_API_KEY</code>.</p></div></div>`
  const dev = opts.dev
    ? `<form method="post" action="/auth/dev" class="dev">
         <div class="or label">local development</div>
         <label class="field"><span>Email</span><input class="input" name="email" type="email" placeholder="you@example.com" required autocomplete="email"></label>
         <button class="btn line lg block" type="submit">Continue with dev login</button></form>`
    : ""
  return shell("Sign in · Parley", `
    <main class="signin">
      ${LOGO}
      <h1>Your messaging, ready for your agents.</h1>
      <p class="sub">Link WhatsApp once. Your agents send and receive over MCP. You never hand them your phone.</p>
      <div class="tiles">${["whatsapp", "telegram", "instagram", "linkedin"].map((id) => `<span class="tile">${channelMark(id, 22)}</span>`).join("")}</div>
      <section class="panel">${signin}${dev}</section>
    </main>`, { css: SIGNIN_CSS })
}

const SIGNIN_CSS = `
.signin{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.5rem;gap:14px}
.signin .logo{font-size:15px}
.signin h1{font-size:30px;line-height:36px;font-weight:400;letter-spacing:-.035em;margin:10px 0 0;max-width:17ch}
.signin .sub{font-size:15px;line-height:23px;color:var(--muted);max-width:42ch;margin:0}
.tiles{display:flex;gap:10px;margin-top:6px}
.tile{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--line-2);border-radius:12px;background:var(--bg-1)}
.signin .panel{width:100%;max-width:300px;margin-top:14px;display:flex;flex-direction:column;gap:12px;text-align:left}
.dev{display:flex;flex-direction:column;gap:12px;margin-top:6px}
.or{display:flex;align-items:center;gap:10px;color:var(--faint)}.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
`

/** The marketing site (itsparley.com). Signing in happens on the app (`appUrl`), so this page only links there. */
export function marketingPage(opts: { appUrl: string }): string {
  const app = esc(opts.appUrl)
  const ch = (id: string) => `<span class="ich">${channelMark(id, 17)}${CHANNELS[id]!.name}</span>`
  const j = (k: string, v: string) => `  <span class="k">"${k}"</span>: ${v}`
  const s = (v: string) => `<span class="s">"${v}"</span>`
  return shell("Parley — messaging infrastructure for agents", `
    <header class="lt"><div class="lt-in">${LOGO}<nav><a href="#how">How it works</a><a href="https://github.com/Verbiflow/parley">GitHub ${icon("external", 12)}</a><a class="open" href="${app}">Open app</a></nav></div></header>
    <main class="land">
      <section class="hero">
        <p class="label">messaging infrastructure for ai agents</p>
        <h1>Give your agents a phone number.</h1>
        <p class="lede">One MCP server for ${ch("whatsapp")} today, with ${ch("telegram")}, ${ch("instagram")} and ${ch("linkedin")} next. Agents read the chats you choose and send from your own account, paced to look like you.</p>
        <a class="btn lg cta" href="${app}">Open app <span class="ar">${icon("arrow", 14)}</span></a>
        <div class="console" id="how">
          <div class="c-bar"><span></span><span></span><span></span><em>mcp · tools/call</em></div>
          <pre><span class="arrow">→</span> <span class="fn">send_message</span>
{
${j("connection_id", s("c7f3e1a0"))},
${j("to", s("+44 7700 900123"))},
${j("text", s("Happy to show you a demo this week."))}
}

<span class="arrow in">←</span> <span class="ok">queued</span>
{
${j("status", s("scheduled"))},
${j("kind", s("first_message"))},
${j("scheduled_for", s("2026-11-04T09:24:00Z"))},
${j("waits", `[${s("outside_active_hours")}]`)},
${j("note", s("Queued for 09:24 London: outside the account's active hours."))}
}</pre>
        </div>
        <ul class="facts">
          <li><span class="label">pacing</span>Active hours, gaps, breaks and warm-up limits on every send.</li>
          <li><span class="label">privacy</span>Ignore any chat and agents never see it. Credentials sealed at rest.</li>
          <li><span class="label">network</span>Each account sends from one stable IP in its own country.</li>
        </ul>
      </section>
    </main>`, { css: LANDING_CSS })
}

const LANDING_CSS = `
.lt{border-bottom:1px solid var(--line)}
.lt-in{max-width:1200px;margin:0 auto;height:56px;padding:0 28px;display:flex;align-items:center;justify-content:space-between}
.lt nav{display:flex;gap:24px;font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lt nav a{display:inline-flex;align-items:center;gap:6px}.lt nav a:hover{color:var(--text)}
.land{max-width:1200px;margin:0 auto;padding:72px 28px 96px}
.cta{margin-top:28px}
.lt nav a.open{color:var(--text);border:1px solid var(--line-3);border-radius:999px;padding:6px 12px}
.hero h1{font-size:60px;line-height:62px;font-weight:400;letter-spacing:-.045em;margin:18px 0 22px;max-width:13ch}
.lede{font-size:17px;line-height:30px;color:var(--muted);max-width:52ch}
.ich{display:inline-flex;align-items:center;gap:6px;color:var(--text);white-space:nowrap}
.console{margin-top:44px;border:1px solid var(--line-2);border-radius:12px;background:var(--bg-1);overflow:hidden;box-shadow:var(--shadow);max-width:640px}
.c-bar{display:flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-bottom:1px solid var(--line)}
.c-bar span{width:9px;height:9px;border-radius:50%;background:var(--bg-3)}
.c-bar em{margin-left:auto;font-style:normal;font-family:var(--mono);font-size:11px;color:var(--faint)}
.console pre{margin:0;padding:18px 20px 20px;font-family:var(--mono);font-size:12.5px;line-height:21px;color:var(--text-2);overflow:auto}
.console .k{color:var(--muted)}.console .s{color:var(--text)}.console .fn{color:var(--text)}.console .arrow{color:var(--faint)}.console .ok{color:var(--signal)}
.facts{list-style:none;margin:40px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:28px;max-width:720px}
.facts li{font-size:13.5px;line-height:21px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}
.facts .label{display:block;margin-bottom:6px;color:var(--text-2)}
@media (max-width:980px){.land{padding-top:40px}.hero h1{font-size:42px;line-height:46px}.facts{grid-template-columns:1fr}}
`

// ---- Overview -----------------------------------------------------------------------------------------------------

const isActive = (a: AgentView) => Boolean(a.lastUsedAt && Date.now() - Date.parse(a.lastUsedAt) < 120_000)

const OVERVIEW_CSS = `
.chan td:first-child{padding-left:0}
.chtags{display:flex;flex-wrap:wrap;gap:6px;margin-right:6px}
.chtag{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border:1px solid var(--line-2);border-radius:999px;background:none;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;text-transform:lowercase;color:var(--text-2);white-space:nowrap}
button.chtag{cursor:pointer;transition:border-color .15s var(--ease),background .15s var(--ease),color .15s var(--ease)}button.chtag:hover{color:var(--text);border-color:var(--line-3);background:var(--hover)}
.chtag.soon{border-style:dashed;color:var(--faint)}.chtag.soon .cm,.chtag.soon svg{filter:grayscale(1);opacity:.5}.chtag i{font-style:normal;color:var(--faint)}
.conns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-top:16px}
.conn{display:flex;flex-direction:column;gap:14px;padding:18px;border:1px solid var(--line-2);border-radius:12px;background:var(--bg-1);transition:border-color .15s var(--ease)}
.conn .ct{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:11px;background:color-mix(in srgb,var(--c) 14%,transparent)}
.conn b{display:block;font-size:15px;font-weight:500;color:var(--text)}
.conn small{display:block;font-size:12.5px;line-height:18px;color:var(--muted);margin-top:2px}
.conn .cf{margin-top:auto}
.conn.ready{border-color:color-mix(in srgb,var(--c) 45%,var(--line-2))}.conn.ready:hover{border-color:var(--c)}
.conn.ready .btn{width:100%;background:var(--c);border-color:var(--c);color:#fff}.conn.ready .btn:hover{filter:brightness(1.06)}
.conn.later{background:transparent;border-style:dashed}.conn.later .ct{filter:grayscale(1);opacity:.55}.conn.later b{color:var(--muted)}.conn.later small{color:var(--faint)}
.conn.ready{box-shadow:var(--shadow)}
.conn.later .cf{height:32px;display:flex;align-items:center}
.conns.compact .conn{flex-direction:row;align-items:center;padding:12px 14px;gap:12px}
.conns.compact .conn .ct{width:34px;height:34px;border-radius:9px}.conns.compact .conn small{display:none}.conns.compact .conn b{font-size:13.5px}
.conns.compact .conn .cf{margin:0 0 0 auto}.conns.compact .conn.ready .btn{width:auto}.conns.compact .conn.later .cf{height:auto}
.stepn{display:inline-grid;place-items:center;flex:none;box-sizing:border-box;width:20px;height:20px;border-radius:50%;border:1px solid var(--line-3);font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;text-box:trim-both cap alphabetic;color:var(--text);margin-right:10px;letter-spacing:0;text-indent:0}
.stepn.done{background:var(--signal);border-color:var(--signal);color:var(--on-ink)}
.done-tag{display:inline-flex;align-items:center;gap:6px;color:var(--signal);font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.seg button .cm,.seg button svg{margin-right:7px}
@media (max-width:980px){.conns{grid-template-columns:repeat(2,minmax(0,1fr))}}
.mcp{display:flex;flex-direction:column;gap:14px;padding-top:16px}
.mcp .tabrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pane{display:flex;flex-direction:column;gap:12px;font-size:13.5px;color:var(--muted);line-height:22px}
.pane ol{margin:0;padding-left:20px}.pane b{color:var(--text);font-weight:500}.pane code{color:var(--text-2)}
.agent-line{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.agent-line b{color:var(--text);font-weight:500}.agent-line a{color:var(--text-2);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-3)}
.live{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ok);margin:0 2px;vertical-align:middle;animation:pulse 2.2s infinite}
`

/** Fill the hidden timezone/country fields of Connect forms from the browser, so pacing starts in the right local hours. */
const LOCALE_SCRIPT = `document.querySelectorAll('form[data-locale]').forEach(f=>{try{f.timezone.value=Intl.DateTimeFormat().resolvedOptions().timeZone||'';const r=(navigator.language||'').split('-')[1];if(r&&/^[A-Za-z]{2}$/.test(r))f.country.value=r.toUpperCase()}catch(e){}});`
const connectForm = (label: string, cls = "btn") => `<form method="post" action="/app/connect" data-locale style="display:contents"><input type="hidden" name="timezone"><input type="hidden" name="country"><button class="${cls}" type="submit">${icon("plus", 13)}${label}</button></form>`

/** One card per channel: the live ones get a Connect button in the brand's color, the rest say "soon". */
function connectorCards(skip: Set<string>, compact = false): string {
  const ids = Object.keys(CHANNELS).filter((id) => !(CHANNELS[id]!.live && skip.has(id)))
  if (!ids.length) return ""
  return `<div class="conns${compact ? " compact" : ""}">${ids.map((id) => {
    const c = CHANNELS[id]!
    return `<div class="conn ${c.live ? "ready" : "later"}" style="--c:${c.color}">
      <span class="ct">${channelMark(id, compact ? 20 : 26)}</span>
      <div><b>${c.name}</b><small>${esc(c.tagline)}</small></div>
      <div class="cf">${c.live ? connectForm(`Connect ${c.name}`, "btn") : `<span class="label">coming soon</span>`}</div>
    </div>`
  }).join("")}</div>`
}

/**
 * Once a channel is linked, the channels are small tags in the section's header row instead of cards:
 * "+ whatsapp" links another number, the rest say soon.
 */
function channelTags(): string {
  return `<div class="chtags">${Object.keys(CHANNELS).map((id) => {
    const c = CHANNELS[id]!
    return c.live
      ? connectForm(`${channelMark(id, 13)}${c.name.toLowerCase()}`, "chtag")
      : `<span class="chtag soon">${channelMark(id, 13)}${c.name.toLowerCase()}<i>soon</i></span>`
  }).join("")}</div>`
}

const stepNo = (n: number, done: boolean) => `<span class="stepn${done ? " done" : ""}">${done ? icon("check", 11, 2.5) : n}</span>`
const doneTag = `<span class="done-tag">${icon("check", 12, 2.25)}done</span>`

function mcpGuide(mcpUrl: string, agents: AgentView[], opts: { open: boolean; step?: number } = { open: true }): string {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(mcpUrl)
  const tabs: Array<[string, string, string, string]> = [
    ["cc", "claude code", "Claude", `<p>Run this, then start <code>claude</code> and type <code>/mcp</code> to sign in.</p>${copyLine(`claude mcp add --transport http parley ${mcpUrl}`, { prompt: "$" })}`],
    ["cx", "codex", "OpenAI", `<p>Run this, then <code>codex mcp login parley</code>.</p>${copyLine(`codex mcp add parley --url ${mcpUrl}`, { prompt: "$" })}`],
    ["cu", "cursor", "Cursor", `<p>Add to <code>~/.cursor/mcp.json</code>, then enable Parley under <b>Settings → MCP</b>.</p>${copyLine(JSON.stringify({ mcpServers: { parley: { url: mcpUrl } } }, null, 2), { multiline: true })}`],
    ["cd", "claude app", "Claude", `<ol><li><b>Settings → Connectors → Add custom connector</b></li><li>Name it Parley and paste the endpoint</li><li><b>Connect</b> and sign in</li></ol>${local ? `<p class="faint">The Claude app connects from Anthropic's servers, so it needs a public URL. Set <code>PUBLIC_URL</code> behind a tunnel, or use Claude Code.</p>` : ""}`],
    ["gpt", "chatgpt", "OpenAI", `<ol><li><b>Settings → Apps &amp; Connectors → Advanced</b>, turn on <b>Developer mode</b></li><li><b>Create</b>, paste the endpoint, pick <b>OAuth</b></li><li>Sign in</li></ol>${local ? `<p class="faint">ChatGPT connects from OpenAI's servers, so it needs a public URL.</p>` : ""}`],
    ["ot", "other", "", `<p>Any MCP client with remote servers (Streamable HTTP + OAuth) works. Add the endpoint; it finds the sign-in on its own.</p>`],
  ]
  const active = agents.filter(isActive)
  const line = agents.length
    ? `<div class="agent-line">${active.length ? `<span class="live"></span>` : agentMark(agents[0]!.clientName, 20)}<span>${active.length
        ? `<b>${esc(active[0]!.clientName || "An agent")}</b> is using Parley right now${active.length > 1 ? ` (+${active.length - 1} more)` : ""}`
        : `${agents.length} agent${agents.length === 1 ? "" : "s"} authorized · ${agents[0]!.lastUsedAt ? `last used ${ago(agents[0]!.lastUsedAt)}` : "not used yet"}`} · <a href="/app/agents">see agents</a></span></div>`
    : ""
  const body = `<div class="mcp" data-tabbox>
      ${copyLine(mcpUrl)}
      <div class="tabrow"><div class="seg" data-tabs>${tabs.map(([id, label, brand], i) => `<button type="button" data-tab="${id}"${i === 0 ? ' class="on"' : ""}>${brandMark(brand, 13)}${label}</button>`).join("")}</div></div>
      ${tabs.map(([id, , , html], i) => `<div class="pane" data-pane="${id}"${i === 0 ? "" : " hidden"}>${html}</div>`).join("")}
      ${line}
    </div>`
  const aside = agents.length && opts.step ? doneTag : agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"} connected` : "streamable http · oauth"
  return foldSection("Add Parley to your AI", body, {
    open: opts.open, aside, lead: opts.step ? stepNo(opts.step, agents.length > 0) : "",
    note: "Parley is an MCP server. Add the endpoint to your AI app; it opens a browser to sign in. No API key to paste.",
  })
}

const MEDIA_LABEL: Record<string, string> = { image: "photo", video: "video", audio: "audio", document: "document" }
/** How a queued send reads in a list: its text, with what it carries when it's a file or a reaction. */
function outText(m: Outbound): string {
  if (m.unsend) return "deleted a message for everyone"
  if (m.reactTo) return m.text ? `reacted ${m.text}` : "took back a reaction"
  if (m.media) return `[${MEDIA_LABEL[m.media.kind] ?? m.media.kind}${m.media.fileName && m.media.kind === "document" ? `: ${m.media.fileName}` : ""}]${m.text ? ` ${m.text}` : ""}`
  return m.text
}

function activityLog(recent: Outbound[], connections: Connection[]): string {
  const tz = new Map(connections.map((c) => [c.id, c.timezone]))
  // With more than one account, each line says which number it went out from.
  const from = connections.filter((c) => c.status !== "logged_out" && c.status !== "error").length > 1
    ? new Map(connections.map((c) => [c.id, waNumber(c.handle) || channelName(c.channel)])) : undefined
  if (!recent.length) return empty("No activity yet", "Sends and failures from your agents show up here as they happen.")
  return `<div class="log${from ? " multi" : ""}">${recent.map((m) => {
    const when = m.sentAt ?? m.createdAt
    const [cls, word] = m.status === "sent" ? ["ok", "sent"] : m.status === "failed" ? ["bad", m.error?.code === "outcome_unknown" ? "interrupted" : "failed"] : m.status === "canceled" ? ["", "canceled"] : ["q", m.status]
    return `<div><span class="t">${stamp(when, tz.get(m.connectionId))}</span><span class="e ${cls}">${word}</span>${from ? `<span class="fr">${esc(from.get(m.connectionId) ?? "")}</span>` : ""}<span class="to">→ ${esc(recipient(m.chatId))}</span><span class="b">${esc(outText(m))}</span></div>`
  }).join("")}</div>`
}

export function dashboardPage(opts: {
  user: Viewer; connections: Connection[]; agents: AgentView[]; mcpUrl: string; syncedCounts?: Map<string, number>
  summaries?: Map<string, ConnectionSummary>; queued?: number; recent?: Outbound[]
}): string {
  const visible = opts.connections.filter((c) => c.status !== "logged_out" && c.status !== "error")
  const live = visible.filter((c) => c.status === "connected")
  const sentToday = [...(opts.summaries?.values() ?? [])].reduce((n, s) => n + s.sentToday, 0)
  const queued = opts.queued ?? [...(opts.summaries?.values() ?? [])].reduce((n, s) => n + s.queued, 0)
  const activeAgents = opts.agents.filter(isActive).length
  const linked = new Set(visible.map((c) => c.channel))

  const rows = visible.map((c) => {
    const st = connectionState(c)
    const s = opts.summaries?.get(c.id)
    const number = waNumber(c.handle)
    // A live row opens the account (its chats and sending settings); until it's linked, the QR page.
    const detail = `/app/connections/${esc(c.id)}`
    return `<tr class="link" data-href="${c.status === "connected" ? detail : `/link/${esc(c.id)}`}">
      <td><div class="who">${channelMark(c.channel, 18)}<div><b>${esc(number || channelName(c.channel))}</b><small>${channelName(c.channel).toLowerCase()}${c.displayName ? ` · ${esc(c.displayName)}` : ""}</small></div></div></td>
      <td>${status(st.tone, st.text, st.live)}</td>
      <td class="m">${s ? `${bar(s.sentToday, s.dailyLimit)}&nbsp;&nbsp;${s.sentToday}<span class="faint">/${s.dailyLimit}</span>` : `<span class="faint">—</span>`}</td>
      <td class="m">${s ? s.queued : "—"}</td>
      <td class="m">${s?.nextAt ? esc(until(s.nextAt, c.timezone)) : `<span class="faint">—</span>`}</td>
      <td class="m">${c.status === "connected" ? `<a href="${detail}">${opts.syncedCounts?.get(c.id) ?? 0} chats</a>` : `<a href="/link/${esc(c.id)}">finish linking</a>`}</td>
      <td class="r">${c.status === "connected" ? icon("arrow", 14) : `<form method="post" action="${detail}/disconnect" data-confirm="Cancel linking this ${esc(channelName(c.channel))} account?" style="display:inline"><button class="btn quiet sm" type="submit">cancel</button></form>`}</td>
    </tr>`
  }).join("")

  const table = `<table class="tbl chan"><thead><tr><th>Account</th><th>Status</th><th>Today</th><th>Queued</th><th>Next send</th><th>Chats</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  const attention = live.filter((c) => c.haltedReason)
  const alerts = attention.map((c) => `<div class="note bad" style="margin-bottom:12px"><div class="grow"><b>${esc(waNumber(c.handle) || channelName(c.channel))} stopped sending</b><p>${esc(HALT_TEXT[c.haltedReason!] ?? "Sending is halted until you resume it.")}</p></div><a class="btn line sm" href="/app/connections/${esc(c.id)}">Review</a></div>`).join("")
  const frame = (body: string) => appShell({
    title: "Overview", active: "overview", user: opts.user, counts: { agents: opts.agents.length, outbox: queued }, css: OVERVIEW_CSS, script: LOCALE_SCRIPT, body,
  })

  // Setup: until a channel is linked and an AI is connected, the page is just the two steps to get there.
  if (!visible.length || !opts.agents.length) {
    const hasChannel = visible.length > 0
    return frame(`${pageHead({ title: "Overview", sub: "Two steps and your agents can message from your own account: link a channel, then add Parley to your AI." })}
    ${alerts}
    ${section("Link a channel", hasChannel ? table : connectorCards(linked), hasChannel ? `${channelTags()}${doneTag}` : "", hasChannel ? "" : "Links as a companion device, the way WhatsApp Web works. Everything syncs except the chats you ignore.", stepNo(1, hasChannel))}
    ${mcpGuide(opts.mcpUrl, opts.agents, { open: true, step: 2 })}`)
  }

  return frame(`${pageHead({
      title: "Overview",
      sub: live.length ? `${live.length} channel${live.length === 1 ? "" : "s"} live. Agents queue messages; Parley sends them at the pace of the person who owns each account.` : "Agents queue messages; Parley sends them at the pace of the person who owns each account.",
      actions: `<a class="btn line" href="/app/outbox">Outbox <span class="ar">${icon("arrow", 13)}</span></a>`,
    })}
    ${alerts}
    <div class="strip">
      <div><span class="label">live channels</span><div class="v">${live.length}</div><div class="h">${visible.length > live.length ? `${visible.length - live.length} waiting to link` : "all online"}</div></div>
      <div><span class="label">sent today</span><div class="v">${sentToday}</div><div class="h">across every channel</div></div>
      <div><span class="label">queued</span><div class="v">${queued}</div><div class="h">${queued ? "going out at a human pace" : "nothing waiting"}</div></div>
      <div><span class="label">agents</span><div class="v">${opts.agents.length}</div><div class="h">${activeAgents ? `${activeAgents} active now` : "none active now"}</div></div>
    </div>
    ${section("Channels", table, channelTags())}
    ${section("Activity", activityLog(opts.recent ?? [], opts.connections), `<a href="/app/outbox?view=recent">all activity</a>`)}
    ${mcpGuide(opts.mcpUrl, opts.agents, { open: false })}`)
}

// ---- Outbox -------------------------------------------------------------------------------------------------------

/** A sent message (not a reaction or a deletion) still young enough to delete for everyone. */
function unsendable(m: Outbound): boolean {
  return m.status === "sent" && !m.reactTo && !m.unsend && Boolean(m.sentAt) && Date.parse(m.sentAt!) + UNSEND_WINDOW_MS > Date.now()
}

export function outboxPage(opts: { user: Viewer; scheduled: Outbound[]; recent: Outbound[]; connections: Connection[]; agentCount: number; filter: "scheduled" | "recent" }): string {
  const byId = new Map(opts.connections.map((c) => [c.id, c]))
  const scheduled = opts.filter === "scheduled"
  const list = scheduled ? opts.scheduled : opts.recent
  const rows = list.map((m) => {
    const c = byId.get(m.connectionId)
    const tz = c?.timezone ?? "UTC"
    return `<tr>
      <td><div class="who">${glyph(recipient(m.chatId), 24, true)}<div><b class="mono" style="color:var(--text)">${esc(recipient(m.chatId))}</b><small>${c ? `${channelName(c.channel).toLowerCase()} · ${esc(waNumber(c.handle))}` : ""}</small></div></div></td>
      <td class="clip">${esc(outText(m))}</td>
      <td><span class="kind${m.kind === "first_message" ? " open" : ""}">${KIND_LABEL[m.kind] ?? m.kind}</span></td>
      <td class="m">${scheduled ? (m.scheduledFor ? esc(until(m.scheduledFor, tz)) : `<span class="faint">held — channel paused</span>`) : outcome(m)}</td>
      <td class="m faint">${scheduled ? (m.scheduledFor ? `${clock(m.scheduledFor, tz)} ${esc(tz.split("/").pop()!.replace(/_/g, " ").toLowerCase())}` : "") : ago(m.sentAt ?? m.createdAt)}</td>
      <td class="r">${scheduled
        ? `<form method="post" action="/app/outbox/${esc(m.id)}/cancel"><button class="btn quiet sm" type="submit">cancel</button></form>`
        : unsendable(m) ? `<form method="post" action="/app/outbox/${esc(m.id)}/unsend"><button class="btn quiet sm" type="submit" title="Delete it for everyone in the chat">delete</button></form>` : ""}</td>
    </tr>`
  }).join("")
  return appShell({
    title: "Outbox", active: "outbox", user: opts.user, counts: { agents: opts.agentCount, outbox: opts.scheduled.length },
    body: `${pageHead({ title: "Outbox", sub: "Everything your agents asked to send. Parley spaces it out so each account sends like the person who owns it.", actions: `<nav class="seg"><a href="/app/outbox" class="${scheduled ? "on" : ""}">scheduled · ${opts.scheduled.length}</a><a href="/app/outbox?view=recent" class="${scheduled ? "" : "on"}">recent</a></nav>` })}
      ${list.length
        ? `<table class="tbl"><thead><tr><th>To</th><th>Message</th><th>Kind</th><th>${scheduled ? "Sends" : "Result"}</th><th>${scheduled ? "Local time" : "When"}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : scheduled ? empty("Nothing scheduled", "Agents queue messages with <code>send_message</code>. Each one shows here with the time it will go out.") : empty("Nothing sent yet", "Sent, failed and canceled messages show up here.")}`,
  })
}

// ---- Agents -------------------------------------------------------------------------------------------------------

const TOOL_LABEL: Record<string, string> = {
  read_inbox: "read your inbox", list_chats: "listed your chats", send_message: "queued a message", connect: "started linking a channel",
  connection_status: "checked a connection", list_connections: "listed connections", list_channels: "listed channels",
  send_availability: "checked when it can send", list_outbox: "read the outbox", cancel_message: "canceled a message",
  react_to_message: "queued a reaction", delete_message: "deleted a sent message", get_media: "opened a photo or file", message_status: "checked on a queued message",
}
function activity(a: AgentView): string {
  if (!a.lastUsedAt) return `Authorized ${ago(a.connectedAt)} · hasn't used Parley yet`
  const did = a.lastTool ? ` · last ${esc(TOOL_LABEL[a.lastTool] ?? a.lastTool)}${a.lastToolAt ? ` ${ago(a.lastToolAt)}` : ""}` : ""
  return `${isActive(a) ? "Using Parley right now" : `Last active ${ago(a.lastUsedAt)}`}${did} · ${a.calls} tool call${a.calls === 1 ? "" : "s"}`
}

export function agentsPage(opts: { user: Viewer; agents: AgentView[]; mcpUrl: string; queuedTotal?: number }): string {
  const rows = opts.agents.map((a) => `<tr>
      <td><div class="who">${agentMark(a.clientName, 30)}<div><b>${esc(a.clientName || "Unnamed MCP client")}${isActive(a) ? ` <span class="live" title="Active in the last 2 minutes"></span>` : ""}</b></div></div></td>
      <td style="color:var(--muted);font-size:13px">${activity(a)}</td>
      <td class="m faint">${day(a.connectedAt)}</td>
      <td class="r"><form method="post" action="/app/agents/${esc(a.sessionId)}/disconnect" data-confirm="Disconnect this agent? It will need to sign in again."><button class="btn warn sm" type="submit">Disconnect</button></form></td>
    </tr>`).join("")
  return appShell({
    title: "Agents", active: "agents", user: opts.user, counts: { agents: opts.agents.length, outbox: opts.queuedTotal }, css: OVERVIEW_CSS,
    body: `${pageHead({ title: "Agents", sub: "Apps you've authorized to read your synced chats and queue messages for you. Disconnecting one cuts off its tokens immediately." })}
      ${section("MCP endpoint", `<div style="padding-top:16px">${copyLine(opts.mcpUrl)}</div>`, "streamable http · oauth")}
      ${section("Authorized", opts.agents.length
        ? `<table class="tbl"><thead><tr><th>Agent</th><th>Activity</th><th>Since</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : empty("No agents yet", "Add the endpoint above to an MCP client. It opens a browser to sign in with this account."), `${opts.agents.length} authorized`)}`,
  })
}

// ---- Network ------------------------------------------------------------------------------------------------------

export function networkPage(opts: { user: Viewer; providers: Provider[]; exits: Exit[]; presets: Array<{ id: string; label: string }>; connections: Connection[]; agentCount: number; queuedTotal: number; error?: string | undefined; hosted: boolean }): string {
  const conns = new Map(opts.connections.map((c) => [c.id, c]))
  const provRows = opts.providers.map((p) => `<tr>
      <td><div class="who">${glyph(p.name, 26)}<div><b>${esc(p.name)}</b><small>${p.type}${p.preset ? ` · ${esc(opts.presets.find((x) => x.id === p.preset)?.label ?? p.preset).toLowerCase()}` : ""}</small></div></div></td>
      <td class="m">${esc(p.kind)}</td>
      <td class="m">${p.type === "gateway" ? esc(p.gateway?.host ?? "") : "—"}</td>
      <td class="m">${p.countries.length ? esc(p.countries.join(" ")) : "any"}</td>
      <td class="m">${p.assigned}<span class="faint">/${p.exits}${p.maxExits ? ` max ${p.maxExits}` : ""}</span></td>
      <td>${p.enabled ? status("ok", "on") : status("idle", "off")}</td>
      <td class="r" style="white-space:nowrap"><form method="post" action="/app/network/providers/${esc(p.id)}/${p.enabled ? "disable" : "enable"}" style="display:inline"><button class="btn quiet sm" type="submit">${p.enabled ? "turn off" : "turn on"}</button></form><form method="post" action="/app/network/providers/${esc(p.id)}/delete" data-confirm="Remove ${esc(p.name)}? Connections using its exits move to another on their next reconnect." style="display:inline"><button class="btn quiet sm" type="submit" aria-label="Remove">${icon("trash", 13)}</button></form></td>
    </tr>`).join("")
  const exitRows = opts.exits.map((e) => {
    const c = e.connectionId ? conns.get(e.connectionId) : undefined
    return `<tr><td class="m">${esc(e.id.slice(0, 8))}</td><td class="m">${esc(e.kind)}</td><td class="m">${esc(e.country)}</td><td class="m">${esc(e.lastIp ?? "—")}</td>
      <td>${status(e.status === "active" ? "ok" : e.status === "cooling" ? "warn" : "bad", e.status === "active" ? "healthy" : e.status)}</td>
      <td>${c ? `<a class="who" href="/app/connections/${esc(c.id)}">${channelMark(c.channel, 15)}<span class="m" style="color:var(--text)">${esc(waNumber(c.handle) || channelName(c.channel))}</span></a>` : `<span class="faint mono">unassigned</span>`}</td></tr>`
  }).join("")
  return appShell({
    title: "Network", active: "network", user: opts.user, counts: { agents: opts.agentCount, outbox: opts.queuedTotal },
    css: `.addf{display:flex;flex-direction:column;gap:16px;padding-top:18px}.addf details summary{cursor:pointer;font-family:var(--mono);font-size:11.5px;color:var(--muted);letter-spacing:.04em}.addf details[open] summary{margin-bottom:14px}.ph-list code{color:var(--text-2)}`,
    body: `${pageHead({ title: "Network", sub: "Each account sends from one stable IP in its own country, and an IP never fronts two accounts on the same platform. Bring residential, mobile, ISP or datacenter proxies; your providers are used before Parley's hosted pool." })}
      ${opts.error ? `<div class="note bad"><div class="grow"><b>Couldn't do that</b><p>${esc(opts.error)}</p></div></div>` : ""}
      ${!opts.providers.length && !opts.hosted ? `<div class="note"><div class="grow"><b>Connections go direct</b><p>Without a provider, accounts connect from Parley's server IP. Add one before linking accounts you care about.</p></div></div>` : ""}
      ${section("Providers", opts.providers.length
        ? `<table class="tbl"><thead><tr><th>Provider</th><th>Type</th><th>Gateway</th><th>Countries</th><th>In use</th><th>State</th><th></th></tr></thead><tbody>${provRows}</tbody></table>`
        : empty("No providers", "Add a gateway (most residential and mobile providers) or a static list below."))}
      <section class="sec" data-tabbox>
        <div class="sec-h"><span class="label">Add provider</span><span class="aside"><span class="seg" data-tabs><button type="button" class="on" data-tab="gw">gateway</button><button type="button" data-tab="st">static list</button></span></span></div>
        <form method="post" action="/app/network/providers" class="addf" data-pane="gw">
          <input type="hidden" name="type" value="gateway">
          <div class="fields">
            <label class="field"><span>Name</span><input class="input" name="name" placeholder="Residential UK" required></label>
            <label class="field"><span>Provider</span><select class="select" name="preset">${opts.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}<option value="">Custom gateway</option></select></label>
            <label class="field"><span>IP type</span><select class="select" name="kind"><option value="residential">Residential</option><option value="mobile">Mobile</option><option value="isp">ISP</option><option value="datacenter">Datacenter</option></select></label>
          </div>
          <div class="fields">
            <label class="field"><span>Username</span><input class="input" name="username" autocomplete="off" required></label>
            <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="new-password" required></label>
            <label class="field"><span>Countries</span><input class="input" name="countries" placeholder="GB US"><small>Empty means any.</small></label>
            <label class="field"><span>Max sessions</span><input class="input" name="max_exits" type="number" min="1" placeholder="unlimited"></label>
          </div>
          <details><summary>custom gateway settings</summary>
            <div class="fields">
              <label class="field"><span>Host</span><input class="input" name="host" placeholder="gate.example.com"></label>
              <label class="field"><span>Port</span><input class="input" name="port" type="number" placeholder="7000"></label>
              <label class="field"><span>Protocol</span><select class="select" name="protocol"><option value="">preset's</option><option>http</option><option>https</option><option>socks5</option></select></label>
              <label class="field"><span>Session lifetime, min</span><input class="input" name="lifetime" type="number" placeholder="1440"></label>
              <label class="field"><span>Username template</span><input class="input mono" name="username_template" placeholder="{username}-country-{country}-session-{session}"></label>
              <label class="field"><span>Password template</span><input class="input mono" name="password_template" placeholder="{password}"></label>
            </div>
            <p class="sec-note ph-list">Placeholders: <code>{username}</code> <code>{password}</code> <code>{country}</code> <code>{COUNTRY}</code> <code>{session}</code> <code>{lifetime}</code></p>
          </details>
          <div><button class="btn" type="submit">Add gateway</button></div>
        </form>
        <form method="post" action="/app/network/providers" class="addf" data-pane="st" hidden>
          <input type="hidden" name="type" value="static">
          <div class="fields">
            <label class="field"><span>Name</span><input class="input" name="name" placeholder="ISP proxies" required></label>
            <label class="field"><span>IP type</span><select class="select" name="kind"><option value="isp">ISP</option><option value="residential">Residential</option><option value="mobile">Mobile</option><option value="datacenter">Datacenter</option></select></label>
          </div>
          <label class="field"><span>Exits</span><textarea class="textarea" name="exits" rows="5" placeholder="http://user:pass@203.0.113.7:8000 US&#10;socks5://user:pass@198.51.100.4:1080 GB" required></textarea><small>One per line: a proxy URL, then its two-letter country.</small></label>
          <div><button class="btn" type="submit">Add list</button></div>
        </form>
      </section>
      ${section("Exits", opts.exits.length
        ? `<table class="tbl"><thead><tr><th>Id</th><th>Type</th><th>Country</th><th>Last IP</th><th>Health</th><th>Account</th></tr></thead><tbody>${exitRows}</tbody></table>`
        : empty("No exits yet", "Gateways mint an exit the first time an account in a matching country connects."), "one per account")}`,
  })
}

// ---- Settings -----------------------------------------------------------------------------------------------------

export function settingsPage(opts: { user: Viewer; sessions: BrowserSessionView[]; currentSessionId: string; agentCount?: number; queuedTotal?: number }): string {
  const u = opts.user
  const rows = opts.sessions.map((s) => {
    const here = s.id === opts.currentSessionId
    return `<tr>
      <td><b style="font-weight:500">${esc(browserName(s.userAgent))}</b>${here ? ` <span class="kind open">· This browser</span>` : ""}</td>
      <td class="m">${s.method ? esc(METHOD[s.method] ?? s.method) : "—"}</td>
      <td class="m faint">signed in ${ago(s.createdAt)}</td>
      <td class="m faint">active ${ago(s.lastSeenAt)}</td>
      <td class="r"><form method="post" action="/app/settings/sessions/${esc(s.id)}/end"><button class="btn ${here ? "line" : "quiet"} sm" type="submit">${here ? "Sign out" : "Revoke"}</button></form></td>
    </tr>`
  }).join("")
  const others = opts.sessions.length > 1 ? `<form method="post" action="/app/settings/sessions/end-others"><button class="btn quiet sm" type="submit">sign out other sessions</button></form>` : ""
  return appShell({
    title: "Settings", active: "settings", user: u, counts: { agents: opts.agentCount, outbox: opts.queuedTotal },
    body: `${pageHead({ title: "Settings", sub: "Your Parley account and where you're signed in.", lead: avatar(u, 40) })}
      ${section("Profile", `<div class="kv">
          <div class="k">name</div><div>${esc(u.name)}</div>
          <div class="k">email</div><div class="mono">${esc(u.email)}</div>
          <div class="k">signed in with</div><div>${esc(METHOD[u.signedInWith ?? ""] ?? "—")}</div>
          <div class="k">member since</div><div>${day(u.createdAt)}</div>
        </div>`, "from your sign-in provider")}
      ${section("Sessions", rows ? `<table class="tbl"><thead><tr><th>Browser</th><th>Method</th><th>Started</th><th>Last seen</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty("No active sessions", ""), others)}
      ${section("Security", `<p class="sec-note">Channel credentials and proxy logins are sealed with AES-256-GCM, bound to the record they belong to. Agents only get the access you authorize; disconnect any of them from <a href="/app/agents" style="color:var(--text);text-decoration:underline;text-underline-offset:3px">Agents</a>.</p>`)}`,
  })
}

// ---- Linking and consent ------------------------------------------------------------------------------------------

const FOCUS_CSS = `
.focus{min-height:100vh;display:flex;flex-direction:column}
.focus > header{height:56px;display:flex;align-items:center;padding:0 28px;border-bottom:1px solid var(--line)}
.focus > main{flex:1;display:grid;place-items:center;padding:40px 20px}
.fc{width:100%;max-width:420px;border:1px solid var(--line-2);border-radius:14px;background:var(--bg-1);overflow:hidden}
.fc-h{padding:22px 24px 18px;border-bottom:1px solid var(--line)}
.fc-h h1{margin:10px 0 0;font-size:24px;line-height:30px;font-weight:400;letter-spacing:-.03em}
.fc-h p{margin-top:6px;font-size:13.5px;color:var(--muted)}
.fc-b{padding:22px 24px 24px;display:flex;flex-direction:column;gap:18px}
.fine{font-size:12px;color:var(--faint);text-align:center;margin-top:18px;max-width:46ch}
`

/** The link page: shows the channel's QR, live-polls, and flips to a success state once connected. */
export function linkPage(id: string): string {
  return shell("Link a channel · Parley", `
    <div class="focus"><header><a href="/app">${LOGO}</a></header><main><div>
      <section class="fc">
        <div class="fc-h"><span class="label" id="step">${channelMark("whatsapp", 13)}&nbsp; whatsapp · link device</span><h1 id="title">Link your account</h1><p id="sub">Preparing a secure link…</p></div>
        <div class="fc-b" id="card"><div class="spin"></div></div>
      </section>
      <p class="fine">Parley links as a companion device, like WhatsApp Web. Unlink it any time from your phone.</p>
      <form method="post" action="/app/connections/${esc(id)}/disconnect" id="cancel" style="text-align:center;margin-top:10px"><button class="btn quiet sm" type="submit">Cancel linking</button></form>
    </div></main></div>
    <script>
      const id=${JSON.stringify(id)};const card=document.getElementById('card'),title=document.getElementById('title'),sub=document.getElementById('sub');
      function render(d){
        if(d.status==='connected'){document.getElementById('cancel')?.remove();title.textContent='Connected';sub.textContent=(d.channel||'Channel').replace(/^./,x=>x.toUpperCase())+' is linked. Your chats sync now; ignore any you want kept from agents.';card.innerHTML='<span class="st ok"><i></i>live</span><a class="btn lg block" href="'+d.chats_url+'">See your chats</a>';return true}
        if(d.qr_svg){title.textContent='Scan to link';sub.textContent='The code refreshes on its own.';card.innerHTML='<div class="qr">'+d.qr_svg+'</div><ol class="ol"><li>Open WhatsApp on your phone</li><li>Settings → Linked devices</li><li>Link a device, then scan</li></ol>';return false}
        card.innerHTML='<div class="spin"></div>';return false
      }
      async function tick(){try{const r=await fetch('/link/'+id+'/status');if(r.ok){if(render(await r.json()))return}}catch(e){}setTimeout(tick,2000)}
      tick();
    </script>`, {
    css: FOCUS_CSS + `
      .qr{align-self:center;width:256px;height:256px;background:#fff;border-radius:10px;display:grid;place-items:center;padding:12px}
      .qr svg{width:100%;height:100%;display:block}
      .ol{margin:0;padding:0;list-style:none;counter-reset:s;display:grid;gap:9px;font-size:13.5px;color:var(--text-2)}
      .ol li{counter-increment:s;display:flex;gap:12px}.ol li::before{content:counter(s,decimal-leading-zero);font-family:var(--mono);font-size:11.5px;color:var(--faint);padding-top:1px}
      .spin{align-self:center;width:22px;height:22px;border-radius:50%;border:2px solid var(--line-2);border-top-color:var(--text);animation:sp .8s linear infinite;margin:40px 0}@keyframes sp{to{transform:rotate(360deg)}}`,
  })
}

const CHATS_CSS = `
.prefs{margin:4px 0 22px;padding:16px 18px;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-1)}
.prefs .today{display:flex;gap:18px;align-items:center;flex-wrap:wrap;font-family:var(--mono);font-size:12.5px;color:var(--text-2)}
.prefs .today .bar{display:inline-block;width:120px;vertical-align:middle;margin:0}
.prefs .today a{color:var(--text-2);text-decoration:underline;text-underline-offset:3px}
.pf{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:14px}
.pf .field{flex:1;min-width:180px}.pf .lim{flex:0 0 120px;min-width:0}.pf .cc{flex:0 0 90px;min-width:0}
.prefs .hint{margin:10px 0 0;font-size:12px;color:var(--faint)}
.lede{font-size:13px;color:var(--text-2);margin:0}
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 0 4px}
.search{position:relative;flex:1;min-width:240px}.search svg{position:absolute;left:11px;top:10px;color:var(--faint)}
.search .input{padding-left:34px}
.chats{border-top:1px solid var(--line);margin-top:12px}
.chat{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}
.chat .grow{flex:1;min-width:0}.chat .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat .s{font-family:var(--mono);font-size:11.5px;color:var(--faint)}
.chat .when{font-family:var(--mono);font-size:11.5px;color:var(--faint);white-space:nowrap}
.chat.off .t,.chat.off .glyph{opacity:.45}
.chat .s.miss{color:var(--bad)}
.ign{font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--line-2);background:transparent;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s var(--ease)}
.ign:hover{border-color:var(--line-3);color:var(--text)}
.chat.off .ign{background:var(--text);border-color:var(--text);color:var(--bg)}
.ign:disabled{opacity:.5;cursor:default}
.none{display:none!important}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{font:inherit;font-size:12.5px;padding:5px 12px;border-radius:999px;border:1px solid var(--line-2);background:transparent;color:var(--text-2);cursor:pointer;transition:all .12s var(--ease)}
.tag:hover{border-color:var(--line-3);color:var(--text)}
.tag[aria-pressed="true"]{background:var(--text);border-color:var(--text);color:var(--bg)}
.tag .n{font-family:var(--mono);font-size:11px;opacity:.6;margin-left:5px}
.older{display:block;width:100%;padding:14px 0;border:0;background:none;color:var(--text-2);font:inherit;font-size:13px;cursor:pointer;text-align:center}
.older:hover{color:var(--text)}
.stale{margin:10px 0 0;font-size:12.5px;color:var(--faint)}
.stale button{font:inherit;color:var(--text-2);background:none;border:0;padding:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.stale button:hover{color:var(--text)}
.tally{font-family:var(--mono);font-size:12px;color:var(--text-2);margin:14px 0 0}
.sync{margin:12px 0 0;padding:14px 16px;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-1)}
.sync .row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.sync .row b{font-weight:500}.sync .row span{font-family:var(--mono);font-size:12px;color:var(--text-2)}
.sync p{margin:8px 0 0;font-size:12.5px;color:var(--faint)}
.bar{height:4px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:10px}
.bar i{display:block;height:100%;background:var(--text);border-radius:99px;transition:width .6s var(--ease)}
.bar.busy i{animation:busy 1.4s var(--ease) infinite alternate}@keyframes busy{from{margin-left:0}to{margin-left:70%}}
.spin{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-2);border-top-color:var(--text);animation:sp .8s linear infinite;margin-bottom:14px}@keyframes sp{to{transform:rotate(360deg)}}
`

/** Today's sending, and the one setting: how many messages a day. */
function sendingPrefs(conn: Connection, today: DailyUsage | null, queued: number): string {
  const used = today ? `<span class="m">${bar(today.sentToday, today.dailyLimit)}&nbsp;&nbsp;${today.sentToday}<span class="faint"> / ${today.dailyLimit} sent today</span></span>` : ""
  return `<div class="prefs">
    <div class="today">${used}${queued ? `<a href="/app/outbox">${queued} queued</a>` : `<span class="faint">nothing queued</span>`}</div>
    <form method="post" action="/app/connections/${esc(conn.id)}/locale" class="pf">
      <label class="field lim"><span>Daily limit</span><input class="input" name="daily_limit" type="number" min="1" max="1000" step="1" value="${conn.dailyLimit}" required></label>
      <button class="btn line sm" type="submit">Save</button>
    </form>
    <p class="hint">Messages a day across every chat: replies, new conversations and reactions all count.</p>
  </div>`
}

/**
 * A connected account: its chats, and how it sends. Everything syncs by default; the person taps Ignore on the few
 * agents shouldn't see (people and groups, most recent first, like their phone). Each tap saves at once; filtering is
 * client-side.
 */
export function chatsPage(opts: { user: Viewer; connection: Connection; chats: ChatRow[]; agentCount: number; saved: boolean; today: DailyUsage | null; queued: number }): string {
  const { connection: conn } = opts
  // Someone WhatsApp has only given a private id for, with no name or number yet, isn't listed: an "Unknown contact" row
  // helps nobody. They still sync, and appear once they're identified (a name arrives, or they merge into a number).
  // A "name" with no letters or digits ("-", ".") names nobody: fall back to the number.
  const chats = opts.chats.map((c) => (c.name && !/[\p{L}\p{N}]/u.test(c.name) ? { ...c, name: null } : c))
    .filter((c) => c.kind === "group" || c.name || phoneOf(c.id))
  const name = channelName(conn.channel)
  // Like your phone: chats with recent activity first. The rest (old groups, people you only share a group with) are
  // a click or a search away, so hundreds of dead groups don't bury the people you actually talk to.
  const isRecent = (c: ChatRow) => Boolean(c.lastMessageAt)
  const recentCount = chats.filter(isRecent).length
  // WhatsApp's link-time history (recent chats, names, calls) keeps arriving for a minute or two after linking.
  // WhatsApp's link-time history (recent chats, names, calls) arrives for a minute or two after linking.
  const since = conn.history.startedAt ?? conn.linkedAt
  const syncing = Boolean(!conn.history.doneAt && since && Date.now() - Date.parse(since) < 5 * 60_000)
  const pct = conn.history.progress
  const counts = { direct: chats.filter((c) => c.kind === "direct").length, group: chats.filter((c) => c.kind === "group").length, ignored: chats.filter((c) => !c.synced).length }
  const rows = chats.map((c) => {
    const label = c.name || phoneOf(c.id) || (c.kind === "group" ? "Unnamed group" : "Unknown contact")
    const base = c.kind === "group" ? "group" : c.name ? phoneOf(c.id) || "contact" : "contact"
    // A call is activity too: say so when it was the last thing that happened, else mention when you last spoke.
    const callWord = c.lastCallKind === "missed" ? "Missed call" : c.lastCallKind === "outgoing" ? "Outgoing call" : "Incoming call"
    const callLast = Boolean(c.lastCallAt && (!c.lastMessageAt || c.lastCallAt >= c.lastMessageAt))
    const sub = callLast ? `${c.kind === "group" ? "Group call" : callWord}${c.kind === "direct" && phoneOf(c.id) && c.name ? ` · ${phoneOf(c.id)}` : ""}`
      : c.lastCallAt ? `${base} · called ${ago(c.lastCallAt)}` : base
    const search = `${label} ${phoneOf(c.id)}`.toLowerCase()
    return `<div class="chat${c.synced ? "" : " off"}" data-id="${esc(c.id)}" data-kind="${c.kind}" data-recent="${isRecent(c) ? 1 : 0}" data-sub="${esc(sub)}" data-q="${esc(search)}">
      ${c.kind === "group" ? `<span class="glyph" style="width:28px;height:28px">${icon("users", 13)}</span>` : glyph(label, 28, true)}
      <div class="grow"><p class="t">${esc(label)}</p><p class="s${callLast && c.lastCallKind === "missed" ? " miss" : ""}">${c.synced ? esc(sub) : "ignored · agents never see it"}</p></div>
      ${c.lastMessageAt ? `<span class="when">${ago(c.lastMessageAt)}</span>` : ""}
      <button type="button" class="ign">${c.synced ? "Ignore" : "Ignored"}</button>
    </div>`
  }).join("")
  const loading = `<div class="empty"><div class="spin"></div><b>Loading your chats</b>Fetching them from ${esc(name)}… this can take a minute after linking.</div>`
  const number = waNumber(conn.handle)
  const st = connectionState(conn)
  const banner = conn.haltedReason
    ? `<div class="note bad"><div class="grow"><b>Sending is stopped</b><p>${esc(HALT_TEXT[conn.haltedReason] ?? `Halted: ${conn.haltedReason}.`)}</p></div>${conn.haltedReason === "banned" ? "" : `<form method="post" action="/app/connections/${esc(conn.id)}/resume"><button class="btn sm" type="submit">Resume sending</button></form>`}</div>`
    : conn.pausedUntil
      ? `<div class="note warn"><div class="grow"><b>Backing off until ${esc(until(conn.pausedUntil, conn.timezone))}</b><p>${esc(name)} asked the account to slow down. Parley waits, then resumes.</p></div><form method="post" action="/app/connections/${esc(conn.id)}/resume"><button class="btn line sm" type="submit">Resume now</button></form></div>`
      : ""
  return appShell({
    title: number || name, active: "overview", user: opts.user, counts: { agents: opts.agentCount }, css: CHATS_CSS,
    body: `${pageHead({
      title: number || name, crumb: { href: "/app", label: "Overview" }, lead: channelMark(conn.channel, 28),
      sub: `${status(st.tone, st.text, st.live)}&nbsp;&nbsp;<span class="mono faint">${name.toLowerCase()}${conn.displayName ? ` · ${esc(conn.displayName)}` : ""} · linked ${conn.linkedAt ? ago(conn.linkedAt) : "—"}</span>`,
      actions: `${conn.status === "connected" ? "" : `<a class="btn" href="/link/${esc(conn.id)}">Finish linking</a>`}
        <form method="post" action="/app/connections/${esc(conn.id)}/disconnect" data-confirm="Disconnect ${esc(number ? `${name} ${number}` : name)}? Your agents will lose access to it."><button class="btn warn" type="submit">Disconnect</button></form>`,
    })}
      ${banner}
      ${sendingPrefs(conn, opts.today, opts.queued)}
      <p class="lede">Everything on ${esc(name)} syncs to your agents except what you ignore. Ignore a chat and Parley deletes what it stored from it, and never keeps its messages.</p>
      ${chats.length ? `<div class="tools">
          <div class="search">${icon("search", 14)}<input class="input" id="q" type="search" placeholder="Search people and groups" autocomplete="off"></div>
          <div class="tags" id="tags">
            <button type="button" class="tag" data-t="direct" aria-pressed="true">People<span class="n">${counts.direct}</span></button>
            <button type="button" class="tag" data-t="group" aria-pressed="true">Groups<span class="n">${counts.group}</span></button>
            <button type="button" class="tag" data-t="off" aria-pressed="false">Ignored<span class="n" id="nign">${counts.ignored}</span></button>
          </div>
        </div>
        <div id="status">${syncing ? `<div class="sync">
            <div class="row"><b>Syncing your chats from ${esc(name)}${pct !== null ? ` · ${pct}%` : "…"}</b><span>${counts.direct} people · ${counts.group} groups so far</span></div>
            <div class="bar${pct === null ? " busy" : ""}"><i style="width:${pct ?? 30}%"></i></div>
            <p>Just linked: recent chats, names and calls are still arriving. The list fills in on its own.</p>
          </div>` : counts.direct < 3 ? `<div class="note"><div class="grow"><b>Load your recent chats</b><p>WhatsApp sends your recent one-to-one chats only while a device is linking, and this link was made before Parley could read them. Relink once (scan a new QR, about 20 seconds) and this list matches your phone.</p></div><button class="btn" type="submit" form="relink">Relink</button></div>` : `<p class="stale">List doesn't match your phone? <button type="submit" form="relink">Relink WhatsApp</button> to rebuild it (scan a new QR, about 20 seconds).</p>`}</div>
        <p class="tally" id="tally"></p>
        <div class="chats" id="list">${rows}</div>
        <div class="empty none" id="nomatch">No chats match.</div>
        <button type="button" class="older none" id="older"></button>
      <form id="relink" method="post" action="/app/connections/${esc(conn.id)}/relink"></form>
      <script>
        const list=document.getElementById('list'),q=document.getElementById('q'),older=document.getElementById('older'),tallyEl=document.getElementById('tally');
        let rows=[...list.querySelectorAll('.chat')];
        // Tags switch on and off independently. People/Groups say which kinds show (both off = both); Ignored narrows to ignored chats.
        const tag={direct:true,group:true,off:false};let all=false;
        function apply(){const t=q.value.trim().toLowerCase();const kinds=tag.direct||tag.group;let n=0,hid=0;
          for(const r of rows){const off=r.classList.contains('off');
            const match=(!kinds||tag[r.dataset.kind])&&(!tag.off||off)&&(!t||r.dataset.q.includes(t));
            const old=!t&&!all&&!tag.off&&r.dataset.recent!=='1';const ok=match&&!old;if(match&&old)hid++;
            r.classList.toggle('none',!ok);if(ok)n++}
          // Nothing recent at all: on an old link show everything rather than an empty list; while a fresh link is still
          // syncing, say the recent chats are coming instead of listing every group A to Z.
          const waiting=!!document.querySelector('#status .sync');
          if(!n&&hid&&!all&&!t&&!waiting){all=true;return apply()}
          const nm=document.getElementById('nomatch');
          nm.textContent=waiting&&!t?'Your recent chats are on their way. They appear here as WhatsApp sends them.':'No chats match.';
          nm.classList.toggle('none',n>0||(hid>0&&!waiting));
          older.classList.toggle('none',!hid);older.textContent='Show '+hid+' older chat'+(hid===1?'':'s');tally()}
        function tally(){const off=rows.filter(r=>r.classList.contains('off')).length;document.getElementById('nign').textContent=off;
          tallyEl.textContent=(rows.length-off)+' of '+rows.length+' chats sync to your agents'+(off?' · '+off+' ignored':'')}
        q.addEventListener('input',apply);
        older.onclick=()=>{all=true;apply()};
        document.getElementById('tags').addEventListener('click',e=>{const b=e.target.closest('.tag');if(!b)return;tag[b.dataset.t]=!tag[b.dataset.t];b.setAttribute('aria-pressed',String(tag[b.dataset.t]));apply()});
        // Ignore / un-ignore saves at once; only this chat changes on the server.
        let saving=0;
        list.addEventListener('click',async e=>{const b=e.target.closest('.ign');if(!b)return;const r=b.closest('.chat');const ignored=!r.classList.contains('off');
          b.disabled=true;saving++;
          try{const res=await fetch('/app/connections/${esc(conn.id)}/chats/ignore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chats:[r.dataset.id],ignored})});
            if(!res.ok)throw new Error(res.status);
            r.classList.toggle('off',ignored);b.textContent=ignored?'Ignored':'Ignore';
            r.querySelector('.s').textContent=ignored?'ignored · agents never see it':r.dataset.sub;tally()}
          catch(x){alert("Couldn't save that. Check your connection and try again.")}
          finally{saving--;b.disabled=false}});
        apply();
        // While a fresh link syncs, pull the page again every few seconds and swap in the list, counts and progress in
        // place: search, tags and scroll stay put, nothing flashes. Stops once the sync has settled.
        ${syncing ? `(function poll(){setTimeout(async()=>{
          if(saving||document.hidden)return poll();
          try{const doc=new DOMParser().parseFromString(await (await fetch(location.pathname,{cache:'no-store'})).text(),'text/html');
            const nl=doc.getElementById('list');if(!nl)return poll();
            list.innerHTML=nl.innerHTML;rows=[...list.querySelectorAll('.chat')];
            for(const t of ['direct','group'])document.querySelector('[data-t='+t+'] .n').textContent=doc.querySelector('[data-t='+t+'] .n').textContent;
            document.getElementById('status').innerHTML=doc.getElementById('status').innerHTML;apply();
            if(doc.querySelector('#status .sync'))poll()}catch(x){poll()}},3000)})();` : ""}
      </script>` : `${loading}<script>setTimeout(()=>location.reload(),3000)</script>`}`,
  })
}

/** "Allow <agent> to use your Parley account?" — shown when an MCP client signs in. Posts back to /oauth/authorize. */
export function consentPage(opts: { clientName: string | null; redirectUri: string; email: string; fields: Record<string, string> }): string {
  const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope"]
    .filter((k) => opts.fields[k] != null)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(opts.fields[k])}">`)
    .join("")
  let host = ""
  try {
    host = new URL(opts.redirectUri).host
  } catch {}
  const name = opts.clientName || "An MCP client"
  const can = (k: string, text: string) => `<li><span class="label">${k}</span>${text}</li>`
  return shell("Allow access · Parley", `
    <div class="focus"><header>${LOGO}</header><main><div>
      <form class="fc" method="post" action="/oauth/authorize">${hidden}
        <div class="fc-h"><div class="pair">${agentMark(opts.clientName, 34)}<span class="dots"></span><span class="pm">${mark(18)}</span></div>
          <h1>Allow ${esc(name)} to use Parley?</h1><p>Signed in as <span class="mono" style="color:var(--text)">${esc(opts.email)}</span></p></div>
        <div class="fc-b">
          <ul class="can">
            ${can("read", "Messages in your chats, except ones you ignore")}
            ${can("send", "Queue messages from your connected accounts, at a human pace")}
            ${can("link", "Start linking a new account (you still scan the QR)")}
          </ul>
          <div class="acts"><button class="btn line lg" type="submit" name="decision" value="deny">Cancel</button><button class="btn lg" type="submit" name="decision" value="allow">Allow</button></div>
        </div>
      </form>
      <p class="fine">${host ? `Returns to <code>${esc(host)}</code>. ` : ""}Disconnect it any time from Agents in your dashboard.</p>
    </div></main></div>`, {
    css: FOCUS_CSS + `
      .pair{display:flex;align-items:center;gap:10px}.dots{width:36px;height:1px;background:repeating-linear-gradient(90deg,var(--line-3) 0 3px,transparent 3px 6px)}
      .pm{display:grid;place-items:center;width:34px;height:34px;border-radius:5px;border:1px solid var(--line-2);background:var(--bg-2)}
      .can{list-style:none;margin:0;padding:0;display:grid}.can li{display:grid;grid-template-columns:56px 1fr;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:13.5px;color:var(--text-2)}
      .can li:first-child{border-top:1px solid var(--line)}.can .label{padding-top:2px}
      .acts{display:grid;grid-template-columns:1fr 1fr;gap:10px}`,
  })
}
