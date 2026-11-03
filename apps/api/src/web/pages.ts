import { parsePhoneNumberFromString } from "libphonenumber-js"
import type { Connection } from "../sessions/store.ts"
import type { ChatRow } from "../sessions/chats.ts"
import type { Availability, Outbound } from "../sessions/outbox.ts"
import type { Exit, Provider } from "../sessions/exits.ts"
import {
  CHANNELS, LOGO, agentMark, ago, appShell, avatar, bar, channelMark, channelName, clock, copyLine, day, empty, esc, glyph, icon,
  mark, pageHead, section, shell, stamp, status, until, type Tone, type Viewer,
} from "./ui.ts"

export type { Viewer } from "./ui.ts"

export type AgentView = {
  sessionId: string; clientName: string | null; clientId: string; connectedAt: string; lastRefreshedAt: string
  lastUsedAt: string | null; lastTool: string | null; lastToolAt: string | null; calls: number
}
export type BrowserSessionView = { id: string; method: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }
/** What the overview shows about a connection's sending: today's usage, what's waiting, and when the next one goes. */
export type ConnectionSummary = { sentToday: number; allowanceToday: number; queued: number; nextAt: string | null }

const METHOD: Record<string, string> = { google: "Google", github: "GitHub", local: "Email (dev login)", proof: "Test account" }
const ACTION_LABEL: Record<string, string> = { message: "Replies", first_message: "New conversations", invite: "Connection requests" }
const KIND_LABEL: Record<string, string> = { message: "reply", first_message: "opener", invite: "invite" }
const WAIT_LABEL: Record<string, string> = {
  paused: "paused", queued: "behind earlier sends", gap: "gap after last send", outside_active_hours: "outside active hours", break: "taking a break",
  action_spacing: "spacing openers", daily_cap: "daily limit reached", weekly_cap: "weekly limit reached",
}
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
  const ch = (id: string) => `<span class="ich">${channelMark(id, 17)}${CHANNELS[id]!.name}</span>`
  const j = (k: string, v: string) => `  <span class="k">"${k}"</span>: ${v}`
  const s = (v: string) => `<span class="s">"${v}"</span>`
  return shell("Parley — messaging infrastructure for agents", `
    <header class="lt"><div class="lt-in">${LOGO}<nav><a href="#how">How it works</a><a href="https://github.com/Verbiflow/parley">GitHub ${icon("external", 12)}</a></nav></div></header>
    <main class="land">
      <section class="hero">
        <p class="label">messaging infrastructure for ai agents</p>
        <h1>Give your agents a phone number.</h1>
        <p class="lede">One MCP server for ${ch("whatsapp")} today, with ${ch("telegram")}, ${ch("instagram")} and ${ch("linkedin")} next. Agents read the chats you choose and send from your own account, paced to look like you.</p>
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
          <li><span class="label">privacy</span>Agents see only the chats you sync. Credentials sealed at rest.</li>
          <li><span class="label">network</span>Each account sends from one stable IP in its own country.</li>
        </ul>
      </section>
      <aside class="auth">
        <div class="panel">
          <p class="label">sign in</p>
          <h2>Welcome to Parley</h2>
          <p class="muted">Use your work account. Signing in for the first time creates your workspace.</p>
          ${signin}${dev}
        </div>
      </aside>
    </main>`, { css: LANDING_CSS })
}

const LANDING_CSS = `
.lt{border-bottom:1px solid var(--line)}
.lt-in{max-width:1200px;margin:0 auto;height:56px;padding:0 28px;display:flex;align-items:center;justify-content:space-between}
.lt nav{display:flex;gap:24px;font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lt nav a{display:inline-flex;align-items:center;gap:6px}.lt nav a:hover{color:var(--text)}
.land{max-width:1200px;margin:0 auto;padding:72px 28px 96px;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:72px;align-items:start}
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
.auth{position:sticky;top:40px}
.panel{display:flex;flex-direction:column;gap:14px;padding:28px;border:1px solid var(--line-2);border-radius:14px;background:var(--bg-1)}
.panel h2{margin:0;font-size:24px;line-height:30px;font-weight:400;letter-spacing:-.03em}
.panel > p.muted{font-size:13.5px;margin-bottom:8px}
.dev{display:flex;flex-direction:column;gap:12px;margin-top:6px}
.or{display:flex;align-items:center;gap:10px;color:var(--faint)}.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
@media (max-width:980px){.land{grid-template-columns:1fr;gap:40px;padding-top:40px}.hero h1{font-size:42px;line-height:46px}.facts{grid-template-columns:1fr}.auth{position:static}}
`

// ---- Overview -----------------------------------------------------------------------------------------------------

const isActive = (a: AgentView) => Boolean(a.lastUsedAt && Date.now() - Date.parse(a.lastUsedAt) < 120_000)

const OVERVIEW_CSS = `
.chan td:first-child{padding-left:0}
.avail{display:flex;flex-wrap:wrap;gap:10px 28px;padding:16px 0 0}
.avail > *{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:var(--text-2)}
.avail .soon{color:var(--faint)}.avail .soon .cm{opacity:.45;filter:grayscale(1)}
.avail .label{font-size:10.5px}
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

function mcpGuide(mcpUrl: string, agents: AgentView[]): string {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(mcpUrl)
  const tabs: Array<[string, string, string]> = [
    ["cc", "claude code", `<p>Run this, then start <code>claude</code> and type <code>/mcp</code> to sign in.</p>${copyLine(`claude mcp add --transport http parley ${mcpUrl}`, { prompt: "$" })}`],
    ["cx", "codex", `<p>Run this, then <code>codex mcp login parley</code>.</p>${copyLine(`codex mcp add parley --url ${mcpUrl}`, { prompt: "$" })}`],
    ["cu", "cursor", `<p>Add to <code>~/.cursor/mcp.json</code>, then enable Parley under <b>Settings → MCP</b>.</p>${copyLine(JSON.stringify({ mcpServers: { parley: { url: mcpUrl } } }, null, 2), { multiline: true })}`],
    ["cd", "claude app", `<ol><li><b>Settings → Connectors → Add custom connector</b></li><li>Name it Parley and paste the endpoint</li><li><b>Connect</b> and sign in</li></ol>${local ? `<p class="faint">The Claude app connects from Anthropic's servers, so it needs a public URL. Set <code>PUBLIC_URL</code> behind a tunnel, or use Claude Code.</p>` : ""}`],
    ["gpt", "chatgpt", `<ol><li><b>Settings → Apps &amp; Connectors → Advanced</b>, turn on <b>Developer mode</b></li><li><b>Create</b>, paste the endpoint, pick <b>OAuth</b></li><li>Sign in</li></ol>${local ? `<p class="faint">ChatGPT connects from OpenAI's servers, so it needs a public URL.</p>` : ""}`],
    ["ot", "other", `<p>Any MCP client with remote servers (Streamable HTTP + OAuth) works. Add the endpoint; it finds the sign-in on its own.</p>`],
  ]
  const active = agents.filter(isActive)
  const line = agents.length
    ? `<div class="agent-line">${active.length ? `<span class="live"></span>` : agentMark(agents[0]!.clientName, 20)}<span>${active.length
        ? `<b>${esc(active[0]!.clientName || "An agent")}</b> is using Parley right now${active.length > 1 ? ` (+${active.length - 1} more)` : ""}`
        : `${agents.length} agent${agents.length === 1 ? "" : "s"} authorized · ${agents[0]!.lastUsedAt ? `last used ${ago(agents[0]!.lastUsedAt)}` : "not used yet"}`} · <a href="/app/agents">see agents</a></span></div>`
    : ""
  return section("Add Parley to your AI", `<div class="mcp" data-tabbox>
      ${copyLine(mcpUrl)}
      <div class="tabrow"><div class="seg" data-tabs>${tabs.map(([id, label], i) => `<button type="button" data-tab="${id}"${i === 0 ? ' class="on"' : ""}>${label}</button>`).join("")}</div></div>
      ${tabs.map(([id, , html], i) => `<div class="pane" data-pane="${id}"${i === 0 ? "" : " hidden"}>${html}</div>`).join("")}
      ${line}
    </div>`, "streamable http · oauth", "Parley is an MCP server. Add the endpoint to your AI app; it opens a browser to sign in. No API key to paste.")
}

function activityLog(recent: Outbound[], connections: Connection[]): string {
  const tz = new Map(connections.map((c) => [c.id, c.timezone]))
  if (!recent.length) return empty("No activity yet", "Sends and failures from your agents show up here as they happen.")
  return `<div class="log">${recent.map((m) => {
    const when = m.sentAt ?? m.createdAt
    const [cls, word] = m.status === "sent" ? ["ok", "sent"] : m.status === "failed" ? ["bad", m.error?.code === "outcome_unknown" ? "interrupted" : "failed"] : m.status === "canceled" ? ["", "canceled"] : ["q", m.status]
    return `<div><span class="t">${stamp(when, tz.get(m.connectionId))}</span><span class="e ${cls}">${word}</span><span class="to">→ ${esc(recipient(m.chatId))}</span><span class="b">${esc(m.text)}</span></div>`
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
    return `<tr class="link" data-href="/app/connections/${esc(c.id)}">
      <td><div class="who">${channelMark(c.channel, 18)}<div><b>${esc(number || channelName(c.channel))}</b><small>${channelName(c.channel).toLowerCase()}${c.displayName ? ` · ${esc(c.displayName)}` : ""}</small></div></div></td>
      <td>${status(st.tone, st.text, st.live)}</td>
      <td class="m">${s ? `${bar(s.sentToday, s.allowanceToday)}&nbsp;&nbsp;${s.sentToday}<span class="faint">/${s.allowanceToday}</span>` : `<span class="faint">—</span>`}</td>
      <td class="m">${s ? s.queued : "—"}</td>
      <td class="m">${s?.nextAt ? esc(until(s.nextAt, c.timezone)) : `<span class="faint">—</span>`}</td>
      <td class="m">${c.status === "connected" ? `<a href="/app/connections/${esc(c.id)}/chats">${c.chatsChosen ? `${opts.syncedCounts?.get(c.id) ?? 0} chats` : "choose chats"}</a>` : `<a href="/link/${esc(c.id)}">finish linking</a>`}</td>
      <td class="r">${icon("arrow", 14)}</td>
    </tr>`
  }).join("")

  const available = Object.keys(CHANNELS).filter((id) => !(CHANNELS[id]!.live && linked.has(id))).map((id) =>
    CHANNELS[id]!.live ? connectForm(`Connect ${CHANNELS[id]!.name}`, "btn line sm") : `<span class="soon">${channelMark(id, 16)}${CHANNELS[id]!.name} <span class="label">soon</span></span>`).join("")

  const attention = live.filter((c) => c.haltedReason)
  return appShell({
    title: "Overview", active: "overview", user: opts.user, counts: { agents: opts.agents.length, outbox: queued }, css: OVERVIEW_CSS, script: LOCALE_SCRIPT,
    body: `${pageHead({
      title: "Overview",
      sub: live.length ? `${live.length} channel${live.length === 1 ? "" : "s"} live. Agents queue messages; Parley sends them at the pace of the person who owns each account.` : "Link a channel, then add Parley to your AI. Agents read the chats you pick and send at a human pace.",
      actions: `<a class="btn line" href="/app/outbox">Outbox <span class="ar">${icon("arrow", 13)}</span></a>${CHANNELS.whatsapp!.live && !linked.has("whatsapp") ? connectForm("Connect WhatsApp") : ""}`,
    })}
    ${attention.map((c) => `<div class="note bad" style="margin-bottom:12px"><div class="grow"><b>${esc(waNumber(c.handle) || channelName(c.channel))} stopped sending</b><p>${esc(HALT_TEXT[c.haltedReason!] ?? "Sending is halted until you resume it.")}</p></div><a class="btn line sm" href="/app/connections/${esc(c.id)}">Review</a></div>`).join("")}
    <div class="strip">
      <div><span class="label">live channels</span><div class="v">${live.length}</div><div class="h">${visible.length > live.length ? `${visible.length - live.length} waiting to link` : "all online"}</div></div>
      <div><span class="label">sent today</span><div class="v">${sentToday}</div><div class="h">across every channel</div></div>
      <div><span class="label">queued</span><div class="v">${queued}</div><div class="h">${queued ? "going out at a human pace" : "nothing waiting"}</div></div>
      <div><span class="label">agents</span><div class="v">${opts.agents.length}</div><div class="h">${activeAgents ? `${activeAgents} active now` : "none active now"}</div></div>
    </div>
    ${section("Channels", `${visible.length ? `<table class="tbl chan"><thead><tr><th>Account</th><th>Status</th><th>Today</th><th>Queued</th><th>Next send</th><th>Chats</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty("No channels linked", "Link WhatsApp as a companion device, the way WhatsApp Web works. Nothing syncs until you choose chats.")}
      <div class="avail">${available}</div>`)}
    ${section("Activity", activityLog(opts.recent ?? [], opts.connections), `<a href="/app/outbox?view=recent">all activity</a>`)}
    ${mcpGuide(opts.mcpUrl, opts.agents)}`,
  })
}

// ---- Connection detail --------------------------------------------------------------------------------------------

/** Hours since local midnight (0–24) of an instant, in a time zone. */
function localHour(iso: string, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(new Date(iso))
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0)
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0)
  return h + m / 60
}

/** The next 24 hours as a strip: the active window, now, and every queued send placed where it will go out. */
function timeline(opts: { start: number; end: number; tz: string; queued: Outbound[]; activeToday: boolean }): string {
  const now = new Date().toISOString()
  const nowH = localHour(now, opts.tz)
  const pct = (h: number) => `${((h / 24) * 100).toFixed(3)}%`
  const soon = opts.queued.filter((m) => m.scheduledFor && Date.parse(m.scheduledFor) - Date.now() < 24 * 3600_000)
  const ticks = soon.map((m) => {
    const h = localHour(m.scheduledFor!, opts.tz)
    const tomorrow = Date.parse(m.scheduledFor!) - Date.now() > (24 - nowH) * 3600_000
    return `<i class="tk${m.kind === "first_message" ? " open" : ""}${tomorrow ? " tmr" : ""}" style="left:${pct(h)}" title="${esc(recipient(m.chatId))} · ${clock(m.scheduledFor!, opts.tz)}${tomorrow ? " tomorrow" : ""}"></i>`
  }).join("")
  return `<div class="tl">
    <div class="tl-track">
      <span class="win${opts.activeToday ? "" : " off"}" style="left:${pct(opts.start)};width:${pct(opts.end - opts.start)}"></span>
      ${ticks}
      <span class="now" style="left:${pct(nowH)}"><em>now ${clock(now, opts.tz)}</em></span>
    </div>
    <div class="tl-axis">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${pct(h)}">${String(h).padStart(2, "0")}</span>`).join("")}</div>
    <div class="tl-key"><span><i class="k-win"></i>active hours</span><span><i class="k-tk"></i>reply</span><span><i class="k-tk open"></i>opener</span><span><i class="k-tk tmr"></i>tomorrow</span></div>
  </div>`
}

const CONNECTION_CSS = `
.tl{padding-top:22px}
.tl-track{position:relative;height:44px;border:1px solid var(--line-2);border-radius:8px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/24 - 1px),var(--line) calc(100%/24 - 1px),var(--line) calc(100%/24));overflow:visible}
.tl .win{position:absolute;top:0;bottom:0;background:var(--signal-dim);border-left:1px solid var(--signal);border-right:1px solid var(--signal)}
.tl .win.off{background:var(--bg-2);border-color:var(--line-3)}
.tl .tk{position:absolute;top:10px;bottom:10px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text-2)}
.tl .tk.open{background:var(--signal)}.tl .tk.tmr{opacity:.4}
.tl .now{position:absolute;top:-6px;bottom:-6px;width:1px;background:var(--text)}
.tl .now em{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-style:normal;font-family:var(--mono);font-size:10.5px;color:var(--text);white-space:nowrap}
.tl-axis{position:relative;height:22px;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
.tl-axis span{position:absolute;top:6px;transform:translateX(-50%)}
.tl-axis span:first-child{transform:none}.tl-axis span:last-child{transform:translateX(-100%)}
.tl-key{display:flex;gap:20px;margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.tl-key span{display:inline-flex;align-items:center;gap:7px}
.k-win{width:14px;height:8px;background:var(--signal-dim);border:1px solid var(--signal);border-radius:2px}
.k-tk{width:2px;height:10px;background:var(--text-2);border-radius:1px}.k-tk.open{background:var(--signal)}.k-tk.tmr{opacity:.4}
.pace{display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:20px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}
.pace .nm{font-size:13.5px;min-width:0}.pace .nm small{display:block;font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pace .bar{width:100%}
.pace .n{font-family:var(--mono);font-size:12.5px;color:var(--text-2);white-space:nowrap}
.locale{display:flex;flex-direction:column;gap:14px;padding-top:16px}
`

export function connectionPage(opts: {
  user: Viewer; connection: Connection; actions: Availability; queued: Outbound[]; recent: Outbound[]
  exit: Exit | undefined; proxied: boolean; agentCount: number; queuedTotal: number; policy: { start: number; end: number; days: number[] }; synced: number
}): string {
  const c = opts.connection
  const st = connectionState(c)
  const number = waNumber(c.handle)
  const tz = c.timezone
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "short" })
  const activeToday = opts.policy.days.includes(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday))
  const days = opts.policy.days.length === 7 ? "every day" : opts.policy.days.length === 5 && !opts.policy.days.includes(0) && !opts.policy.days.includes(6) ? "weekdays" : `${opts.policy.days.length} days a week`
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`

  const banner = c.haltedReason
    ? `<div class="note bad"><div class="grow"><b>Sending is stopped</b><p>${esc(HALT_TEXT[c.haltedReason] ?? `Halted: ${c.haltedReason}.`)}</p></div>${c.haltedReason === "banned" ? "" : `<form method="post" action="/app/connections/${esc(c.id)}/resume"><button class="btn sm" type="submit">Resume sending</button></form>`}</div>`
    : c.pausedUntil
      ? `<div class="note warn"><div class="grow"><b>Backing off until ${esc(until(c.pausedUntil, tz))}</b><p>WhatsApp asked the account to slow down. Parley waits, then resumes at a lower pace.</p></div><form method="post" action="/app/connections/${esc(c.id)}/resume"><button class="btn line sm" type="submit">Resume now</button></form></div>`
      : ""

  const pace = Object.entries(opts.actions).map(([action, a]) => {
    const next = a!.canSendNow ? `<span class="st ok"><i></i>can send now</span>` : a!.earliestAt ? `<span class="faint">next ${esc(until(a!.earliestAt, tz))}${a!.waits.length ? ` · ${a!.waits.map((w) => WAIT_LABEL[w] ?? w).join(", ")}` : ""}</span>` : `<span class="faint">${a!.reason === "paused" ? "paused" : "unavailable"}</span>`
    return `<div class="pace"><div class="nm">${ACTION_LABEL[action] ?? action}<small>${next}</small></div>${bar(a!.usedToday, a!.allowance)}<span class="n">${a!.usedToday} / ${a!.allowance}</span></div>`
  }).join("")

  const outRow = (m: Outbound, scheduled: boolean) => `<tr>
      <td><div class="who">${glyph(recipient(m.chatId), 22, true)}<span class="m" style="color:var(--text)">${esc(recipient(m.chatId))}</span></div></td>
      <td class="clip">${esc(m.text)}</td>
      <td><span class="kind${m.kind === "first_message" ? " open" : ""}">${KIND_LABEL[m.kind] ?? m.kind}</span></td>
      <td class="m">${scheduled ? (m.scheduledFor ? esc(until(m.scheduledFor, tz)) : `<span class="faint">held</span>`) : outcome(m)}</td>
      <td class="m faint">${scheduled ? (m.scheduledFor ? clock(m.scheduledFor, tz) : "") : m.sentAt ? ago(m.sentAt) : ago(m.createdAt)}</td>
      <td class="r">${scheduled ? `<form method="post" action="/app/outbox/${esc(m.id)}/cancel"><input type="hidden" name="back" value="/app/connections/${esc(c.id)}"><button class="btn quiet sm" type="submit">cancel</button></form>` : ""}</td>
    </tr>`
  const table = (list: Outbound[], scheduled: boolean) => `<table class="tbl"><thead><tr><th>To</th><th>Message</th><th>Kind</th><th>${scheduled ? "Sends" : "Result"}</th><th>${scheduled ? "Local" : "When"}</th><th></th></tr></thead><tbody>${list.map((m) => outRow(m, scheduled)).join("")}</tbody></table>`

  const exit = opts.exit
  const network = exit
    ? `<div class="kv"><div class="k">exit</div><div>${esc(exit.kind)} · ${esc(exit.country)}</div><div class="k">ip</div><div class="mono">${esc(exit.lastIp ?? "not checked yet")}</div><div class="k">health</div><div>${status(exit.status === "active" ? "ok" : exit.status === "cooling" ? "warn" : "bad", exit.status === "active" ? "healthy" : exit.status)}</div></div>`
    : `<p class="sec-note">${opts.proxied ? "No exit assigned yet. One is picked the next time the connection opens." : `Connected directly from Parley's server. Add a provider on <a href="/app/network" style="color:var(--text);text-decoration:underline;text-underline-offset:3px">Network</a> to send from an IP in ${esc(c.country ?? "the account's country")}.`}</p>`

  return appShell({
    title: number || channelName(c.channel), active: "overview", user: opts.user, counts: { agents: opts.agentCount, outbox: opts.queuedTotal }, css: CONNECTION_CSS,
    body: `${pageHead({
      title: number || channelName(c.channel), crumb: { href: "/app", label: "Overview" }, lead: channelMark(c.channel, 28),
      sub: `${status(st.tone, st.text, st.live)}&nbsp;&nbsp;<span class="mono faint">${channelName(c.channel).toLowerCase()}${c.displayName ? ` · ${esc(c.displayName)}` : ""} · linked ${c.linkedAt ? ago(c.linkedAt) : "—"} · ${esc(tz)}</span>`,
      actions: `${c.status === "connected" ? `<a class="btn line" href="/app/connections/${esc(c.id)}/chats">${opts.synced} chat${opts.synced === 1 ? "" : "s"} synced</a>` : `<a class="btn" href="/link/${esc(c.id)}">Finish linking</a>`}
        <form method="post" action="/app/connections/${esc(c.id)}/disconnect" data-confirm="Disconnect ${esc(channelName(c.channel))}? Your agents will lose access to it."><button class="btn warn" type="submit">Disconnect</button></form>`,
    })}
    ${banner}
    ${section("Local day", timeline({ start: opts.policy.start, end: opts.policy.end, tz, queued: opts.queued, activeToday }), `${hh(opts.policy.start)}–${hh(opts.policy.end)} ${esc(tz)} · ${days}`)}
    <div class="split">
      <div>
        ${section("Sending today", pace || empty("Not sending yet", "Pacing appears once the connection is live."), "", `Daily limits start low and grow as the account proves it can carry them. Any pushback from ${channelName(c.channel)} halves them.`)}
        ${section("Up next", opts.queued.length ? table(opts.queued, true) : empty("Nothing queued", "When an agent calls <code>send_message</code>, it lands here with the time it will go out."), `<a href="/app/outbox">outbox</a>`)}
        ${opts.recent.length ? section("Recent", table(opts.recent, false)) : ""}
      </div>
      <div>
        ${section("Schedule", `<form method="post" action="/app/connections/${esc(c.id)}/locale" class="locale">
            <label class="field"><span>Time zone</span><input class="input" name="timezone" value="${esc(tz)}" list="tzs" required></label>
            <label class="field"><span>Country</span><input class="input" name="country" value="${esc(c.country ?? "")}" maxlength="2" placeholder="GB" pattern="[A-Za-z]{2}"><small>Where the account lives. Active hours follow its clock; its exit IP is picked here.</small></label>
            <datalist id="tzs">${["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Africa/Lagos"].map((z) => `<option value="${z}">`).join("")}</datalist>
            <div><button class="btn line sm" type="submit">Save</button></div>
          </form>`)}
        ${section("Network", network, `<a href="/app/network">manage</a>`)}
      </div>
    </div>`,
  })
}

// ---- Outbox -------------------------------------------------------------------------------------------------------

export function outboxPage(opts: { user: Viewer; scheduled: Outbound[]; recent: Outbound[]; connections: Connection[]; agentCount: number; filter: "scheduled" | "recent" }): string {
  const byId = new Map(opts.connections.map((c) => [c.id, c]))
  const scheduled = opts.filter === "scheduled"
  const list = scheduled ? opts.scheduled : opts.recent
  const rows = list.map((m) => {
    const c = byId.get(m.connectionId)
    const tz = c?.timezone ?? "UTC"
    return `<tr>
      <td><div class="who">${glyph(recipient(m.chatId), 24, true)}<div><b class="mono" style="color:var(--text)">${esc(recipient(m.chatId))}</b><small>${c ? `${channelName(c.channel).toLowerCase()} · ${esc(waNumber(c.handle))}` : ""}</small></div></div></td>
      <td class="clip">${esc(m.text)}</td>
      <td><span class="kind${m.kind === "first_message" ? " open" : ""}">${KIND_LABEL[m.kind] ?? m.kind}</span></td>
      <td class="m">${scheduled ? (m.scheduledFor ? esc(until(m.scheduledFor, tz)) : `<span class="faint">held — channel paused</span>`) : outcome(m)}</td>
      <td class="m faint">${scheduled ? (m.scheduledFor ? `${clock(m.scheduledFor, tz)} ${esc(tz.split("/").pop()!.replace(/_/g, " ").toLowerCase())}` : "") : ago(m.sentAt ?? m.createdAt)}</td>
      <td class="r">${scheduled ? `<form method="post" action="/app/outbox/${esc(m.id)}/cancel"><button class="btn quiet sm" type="submit">cancel</button></form>` : ""}</td>
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
    </div></main></div>
    <script>
      const id=${JSON.stringify(id)};const card=document.getElementById('card'),title=document.getElementById('title'),sub=document.getElementById('sub');
      function render(d){
        if(d.status==='connected'){title.textContent='Connected';sub.textContent=(d.channel||'Channel').replace(/^./,x=>x.toUpperCase())+' is linked. Nothing syncs until you choose chats.';card.innerHTML='<span class="st ok"><i></i>live</span><a class="btn lg block" href="'+d.chats_url+'">Choose chats</a>';return true}
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
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 0 4px}
.search{position:relative;flex:1;min-width:240px}.search svg{position:absolute;left:11px;top:10px;color:var(--faint)}
.search .input{padding-left:34px}
.chats{border-top:1px solid var(--line);margin-top:12px}
.chat{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);cursor:pointer;user-select:none}
.chat:hover{background:var(--hover)}
.chat input{position:absolute;opacity:0;pointer-events:none}
.box{width:16px;height:16px;border-radius:4px;border:1px solid var(--line-3);display:grid;place-items:center;flex:none;color:transparent;transition:all .12s var(--ease)}
.chat:has(input:checked) .box{background:var(--text);border-color:var(--text);color:var(--bg)}
.chat:has(input:focus-visible) .box{box-shadow:var(--ring)}
.chat .grow{flex:1;min-width:0}.chat .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat .s{font-family:var(--mono);font-size:11.5px;color:var(--faint)}
.chat .when{font-family:var(--mono);font-size:11.5px;color:var(--faint);white-space:nowrap}
.save{position:sticky;bottom:20px;display:flex;align-items:center;gap:8px;margin-top:20px;padding:10px 10px 10px 18px;border:1px solid var(--line-2);border-radius:999px;background:var(--bg-1);box-shadow:var(--shadow)}
.save .grow{flex:1;font-family:var(--mono);font-size:12px;color:var(--text-2)}
.none{display:none!important}
.spin{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-2);border-top-color:var(--text);animation:sp .8s linear infinite;margin-bottom:14px}@keyframes sp{to{transform:rotate(360deg)}}
`

/**
 * Choose which chats sync. Every chat the channel reported is listed (people and groups, most recent first); the
 * person ticks the ones agents may read. Searching/filtering is client-side; the form posts every checked id.
 */
export function chatsPage(opts: { user: Viewer; connection: Connection; chats: ChatRow[]; agentCount: number; saved: boolean }): string {
  const { connection: conn, chats } = opts
  const name = channelName(conn.channel)
  const rows = chats.map((c) => {
    const label = c.name || phoneOf(c.id) || (c.kind === "group" ? "Unnamed group" : "Unknown contact")
    const sub = c.kind === "group" ? "group" : c.name ? phoneOf(c.id) || "contact" : "contact"
    const search = `${label} ${phoneOf(c.id)}`.toLowerCase()
    return `<label class="chat" data-kind="${c.kind}" data-q="${esc(search)}">
      <input type="checkbox" name="chat" value="${esc(c.id)}"${c.synced ? " checked" : ""}>
      <span class="box">${icon("check", 11, 3)}</span>
      ${c.kind === "group" ? `<span class="glyph" style="width:28px;height:28px">${icon("users", 13)}</span>` : glyph(label, 28, true)}
      <div class="grow"><p class="t">${esc(label)}</p><p class="s">${esc(sub)}</p></div>
      ${c.lastMessageAt ? `<span class="when">${ago(c.lastMessageAt)}</span>` : ""}
    </label>`
  }).join("")
  const loading = `<div class="empty"><div class="spin"></div><b>Loading your chats</b>Fetching them from ${esc(name)}… this can take a minute after linking.</div>`
  return appShell({
    title: "Choose chats", active: "overview", user: opts.user, counts: { agents: opts.agentCount }, css: CHATS_CSS,
    body: `${pageHead({
      title: "Choose what to sync", crumb: { href: `/app/connections/${esc(conn.id)}`, label: waNumber(conn.handle) || name },
      sub: `Your agents can only read the chats you pick on ${esc(name)}${conn.handle ? ` (${esc(waNumber(conn.handle))})` : ""}. Unticking a chat deletes what Parley stored from it.`,
    })}
      ${opts.saved ? `<div class="note ok"><div class="grow"><b>Saved</b><p>Your agents now see only the chats ticked below.</p></div></div>` : ""}
      ${chats.length ? `<form method="post" id="f">
        <div class="tools">
          <div class="search">${icon("search", 14)}<input class="input" id="q" type="search" placeholder="Search people and groups" autocomplete="off"></div>
          <div class="seg" id="seg"><button type="button" class="on" data-f="all">all</button><button type="button" data-f="direct">people</button><button type="button" data-f="group">groups</button><button type="button" data-f="on">selected</button></div>
        </div>
        <div class="chats" id="list">${rows}<div class="empty none" id="nomatch">No chats match.</div></div>
        <div class="save"><span class="grow" id="count"></span>
          <button class="btn quiet sm" type="button" id="all">select shown</button>
          <button class="btn quiet sm" type="button" id="clear">clear shown</button>
          <button class="btn" type="submit">Save</button></div>
      </form>
      <script>
        const list=document.getElementById('list'),q=document.getElementById('q'),count=document.getElementById('count');let f='all';
        const rows=[...list.querySelectorAll('.chat')];
        const shown=()=>rows.filter(r=>!r.classList.contains('none'));
        function apply(){const t=q.value.trim().toLowerCase();let n=0;for(const r of rows){const on=r.querySelector('input').checked;const ok=(f==='all'||(f==='on'?on:r.dataset.kind===f))&&(!t||r.dataset.q.includes(t));r.classList.toggle('none',!ok);if(ok)n++}document.getElementById('nomatch').classList.toggle('none',n>0);tally()}
        function tally(){const n=rows.filter(r=>r.querySelector('input').checked).length;count.textContent=n?n+' of '+rows.length+' selected':'nothing selected — agents see no chats'}
        q.addEventListener('input',apply);list.addEventListener('change',tally);
        document.getElementById('seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;f=b.dataset.f;document.querySelectorAll('#seg button').forEach(x=>x.classList.toggle('on',x===b));apply()});
        document.getElementById('all').onclick=()=>{shown().forEach(r=>r.querySelector('input').checked=true);tally()};
        document.getElementById('clear').onclick=()=>{shown().forEach(r=>r.querySelector('input').checked=false);tally()};
        tally();
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
            ${can("read", "Messages in the chats you chose to sync")}
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
