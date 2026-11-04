/**
 * The marketing site (itsparley.com). Its own document, not the console's `shell`. Signing in happens on the app
 * (`appUrl`), so this page only links there. Pacing numbers come from `POLICIES.whatsapp` in `@parley/pacing`;
 * change them together.
 */
import { AGENT_BRANDS } from "./agent-brands.ts"
import { CHANNELS, MARK_PATH, esc, mark } from "./ui.ts"

const svg = (size: number, body: string, fill = "currentColor") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" aria-hidden="true">${body}</svg>`
const line = (size: number, body: string, stroke = 1.75) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const channelPath = (id: string) => `<path d="${CHANNELS[id]!.path}"/>`

const SLACK = [
  ["#E01E5A", "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"],
  ["#36C5F0", "M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"],
  ["#2EB67D", "M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"],
  ["#ECB22E", "M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"],
]

/** Channel marks. iMessage has no published mark, so it's drawn: a white bubble on Apple's green. */
const LOGOS: Record<string, (size: number) => string> = {
  whatsapp: (s) => svg(s, channelPath("whatsapp"), CHANNELS.whatsapp!.color),
  imessage: (s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><defs><linearGradient id="im${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6df26a"/><stop offset="1" stop-color="#0dbd2b"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#im${s})"/><path fill="#fff" d="M12 5.3c-4.2 0-7.6 2.8-7.6 6.2 0 2 1.15 3.75 2.95 4.9-.15 1-.75 2.05-1.6 2.75 1.65-.05 3.05-.65 4.05-1.55.7.15 1.45.25 2.2.25 4.2 0 7.6-2.8 7.6-6.35S16.2 5.3 12 5.3z"/></svg>`,
  slack: (s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${SLACK.map(([c, d]) => `<path fill="${c}" d="${d}"/>`).join("")}</svg>`,
  linkedin: (s) => svg(s, channelPath("linkedin"), "#0A66C2"),
  telegram: (s) => svg(s, channelPath("telegram"), CHANNELS.telegram!.color),
  instagram: (s) => svg(s, channelPath("instagram"), CHANNELS.instagram!.color),
}

const brand = (title: string, size = 18) => {
  const b = AGENT_BRANDS.find((x) => x.title === title)
  return b ? svg(size, `<path d="${b.path}"/>`) : ""
}
const claude = (size: number) => {
  const b = AGENT_BRANDS.find((x) => x.title === "Claude")!
  return svg(size, `<path d="${b.path}"/>`, b.hex)
}

const I = {
  inbox: `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  send: `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
  bot: `<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  copy: `<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  arrow: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  chev: `<path d="m7 10 5 5 5-5"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
  lock: `<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  repeat: `<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>`,
  plug: `<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>`,
}
const TICKS = `<svg viewBox="0 0 16 11" width="14" height="10" aria-hidden="true"><path fill="currentColor" d="M11.07.65 4.98 7.34 2.5 4.8 1.4 5.9l3.6 3.6L12.2 1.75zM15.1.65 9.02 7.34 8.1 6.4 7 7.5l2.03 2 7.18-7.75z"/></svg>`

/** Hours (0–24) to a percentage across a day. */
const pct = (h: number) => `${((h / 24) * 100).toFixed(2)}%`
const initials = (name: string) => esc(name.split(" ").map((w) => w[0]).join("").slice(0, 2))
const av = (name: string, hue: number, size = 28) => `<span class="av" style="--h:${hue};width:${size}px;height:${size}px">${initials(name)}</span>`

/** One day of sends: the active window, bursts of replies, and the few openers. */
function dayStrip(cls = ""): string {
  const bursts: Array<[number, number]> = [[8.2, 7], [9.65, 7], [11.3, 6], [13.8, 7], [16.1, 7], [19.05, 6]]
  const ticks = bursts.flatMap(([at, n]) => Array.from({ length: n }, (_, i) => at + i * 0.09))
  return `<div class="ds ${cls}"><div class="ds-t">
      <span class="ds-n" style="left:0;width:${pct(8)}"></span><span class="ds-n" style="left:${pct(21)};width:${pct(3)}"></span>
      <span class="ds-w" style="left:${pct(8)};width:${pct(13)}"></span>
      ${ticks.map((h) => `<i style="left:${pct(h)}"></i>`).join("")}${[9.4, 12.9, 16.6].map((h) => `<b style="left:${pct(h)}"></b>`).join("")}
    </div><div class="ds-a"><span>00</span><span style="left:${pct(8)}">08:00</span><span style="left:${pct(21)}">21:00</span><span>24</span></div></div>`
}

/** The hero: Parley's inbox the way the account holder sees it, mid-morning after an agent replied overnight. */
function appFrame(): string {
  const item = (name: string, hue: number, text: string, when: string, opts: { on?: boolean; tag?: string; group?: boolean } = {}) => `<div class="li${opts.on ? " on" : ""}">
      ${av(name, hue, 30)}
      <div class="li-m"><div class="li-h"><b>${esc(name)}</b><time>${when}</time></div><p>${esc(text)}</p>${opts.tag ? `<span class="li-t">${opts.tag}</span>` : ""}</div>
    </div>`
  const bar = (label: string, used: number, of: number) => `<div class="bar"><div class="bar-h"><span>${label}</span><span><b>${used}</b> / ${of}</span></div><div class="bar-t"><i style="width:${Math.round((used / of) * 100)}%"></i></div></div>`
  return `<div class="app" aria-hidden="true">
    <aside class="sb">
      <div class="ws"><span class="ws-m">${mark(12)}</span><b>Parley</b>${line(14, I.chev)}</div>
      <nav class="sn">
        <a class="on">${line(15, I.inbox)}Inbox<span>4</span></a>
        <a>${line(15, I.send)}Outbox<span>3</span></a>
        <a>${line(15, I.bot)}Agents</a>
      </nav>
      <p class="sl">Channels</p>
      <nav class="sn">
        <a>${LOGOS.whatsapp!(14)}WhatsApp<i class="dot"></i></a>
        <a class="soon">${LOGOS.imessage!(14)}iMessage<em>Soon</em></a>
        <a class="soon">${LOGOS.slack!(14)}Slack<em>Soon</em></a>
        <a class="soon">${LOGOS.linkedin!(14)}LinkedIn<em>Soon</em></a>
      </nav>
      <p class="sl">Agents</p>
      <nav class="sn">
        <a>${claude(14)}Claude<i class="dot"></i></a>
        <a>${brand("Cursor", 14)}Cursor</a>
      </nav>
    </aside>
    <section class="ls">
      <header class="ph"><b>Inbox</b><span class="seg"><span class="on">All</span><span>Waiting on you</span></span></header>
      ${item("Maya Okafor", 28, "Same place. I'll bring the new deck.", "08:21", { on: true, tag: `${claude(11)} Replied by Claude` })}
      ${item("Sam Reyes", 200, "Sorry I missed your call. Free after 5?", "08:14", { tag: "Waiting on you" })}
      ${item("Product team", 150, "Shipped the fix. Notes are in the doc.", "07:58")}
      ${item("Priya Shah", 330, "Could you resend the invoice?", "Mon", { tag: "Waiting on you" })}
      ${item("Jonas Berg", 50, "Thanks, I'll confirm on Monday.", "Mon")}
    </section>
    <section class="th">
      <header class="ph th-h">${av("Maya Okafor", 28, 26)}<div><b>Maya Okafor</b><small>+44 7700 900123</small></div><span class="via">${LOGOS.whatsapp!(13)}WhatsApp</span></header>
      <div class="msgs">
        <span class="day">Yesterday</span>
        <div class="m rx"><p>Hey, are we still on for Thursday? No rush, tell me tomorrow.</p><time>21:42</time></div>
        <div class="ev">${claude(12)}<span><b>Claude</b> queued a reply</span><time>21:43</time></div>
        <div class="ev">${line(12, I.clock, 2)}<span>Held until <b>08:00</b>, outside active hours</span></div>
        <span class="day">Today</span>
        <div class="m tx"><p>Morning! Yes, Thursday at 3 still works.</p><time>08:12 <span class="tk">${TICKS}</span></time></div>
        <div class="m rx"><p>Perfect. Same place as last time?</p><time>08:19</time></div>
        <div class="m tx q"><p>Same place. I'll bring the new deck.</p><time>${line(11, I.clock, 2)} sends in 1m 48s</time></div>
      </div>
      <div class="cmp"><span>Message Maya</span><kbd>⌘ ↵</kbd></div>
    </section>
    <aside class="dt">
      <div class="dt-s"><p class="sl">Pacing</p>
        <dl><div><dt>Active hours</dt><dd>08:00 – 21:00</dd></div><div><dt>Time zone</dt><dd>Europe/London</dd></div><div><dt>Next send</dt><dd>in 1m 48s</dd></div></dl>
        ${dayStrip("mini")}
      </div>
      <div class="dt-s"><p class="sl">Today</p>${bar("Replies", 12, 40)}${bar("New conversations", 1, 3)}</div>
      <div class="dt-s"><p class="sl">This chat</p><div class="vis"><span>Visible to agents</span><span class="tg on"><i></i></span></div></div>
    </aside>
  </div>`
}

function qr(): string {
  const n = 21
  let s = 11
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const inFinder = (r: number, c: number) => [[0, 0], [0, n - 7], [n - 7, 0]].some(([r0, c0]) => r >= r0! && r < r0! + 7 && c >= c0! && c < c0! + 7)
  const cells: string[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!inFinder(r, c) && rnd() > 0.54) cells.push(`M${c} ${r}h1v1h-1z`)
  const eye = (x: number, y: number) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`
  return `<svg viewBox="-1.5 -1.5 ${n + 3} ${n + 3}" width="96" height="96" shape-rendering="crispEdges" aria-hidden="true"><rect x="-1.5" y="-1.5" width="${n + 3}" height="${n + 3}" rx="2" fill="#efebe4"/><path fill="#14130f" fill-rule="evenodd" d="${cells.join("")}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}"/></svg>`
}

const CHANNEL_LIST: Array<{ id: string; name: string; note: string; live?: boolean }> = [
  { id: "whatsapp", name: "WhatsApp", note: "Your own number, linked by QR", live: true },
  { id: "imessage", name: "iMessage", note: "Blue bubbles from a real Apple ID" },
  { id: "slack", name: "Slack", note: "DMs and channels in your workspaces" },
  { id: "linkedin", name: "LinkedIn", note: "Messages and connection requests" },
  { id: "telegram", name: "Telegram", note: "Personal accounts and groups" },
  { id: "instagram", name: "Instagram", note: "Direct messages" },
]

export function marketingPage(opts: { appUrl: string }): string {
  const app = esc(opts.appUrl)
  const mcp = `${opts.appUrl}/mcp`
  const gh = "https://github.com/Verbiflow/parley"
  const inline = (id: string, name: string) => `<span class="ic">${LOGOS[id]!(18)}${name}</span>`
  const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d0c0a"/><g transform="translate(11 9) scale(.68)"><path fill="#f3f0ea" fill-rule="evenodd" d="${MARK_PATH}"/></g></svg>`)}`
  const description = "Messaging infrastructure for AI agents. Connect your agents to WhatsApp today, with iMessage, Slack and LinkedIn coming soon."
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Parley · Messaging infrastructure for AI agents</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="Parley · Messaging infrastructure for AI agents"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website">
<meta name="theme-color" content="#0d0c0a"><meta name="color-scheme" content="dark"><link rel="icon" href="${favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..650&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header class="nav"><div class="in">
  <a class="logo" href="/" aria-label="Parley home">${mark(18)}<span>Parley</span></a>
  <nav><a href="#channels">Channels</a><a href="#how">How it works</a><a href="${gh}">GitHub</a></nav>
  <div class="nav-r"><a class="lnk" href="${app}">Log in</a><a class="btn sm" href="${app}">Get started</a></div>
</div></header>

<main>
  <section class="hero in">
    <div class="hero-t">
      <h1>Messaging infrastructure<br>for AI agents</h1>
      <div class="hero-r">
        <p class="lede">Connect your agents to ${inline("whatsapp", "WhatsApp")} today, with ${inline("imessage", "iMessage")}, ${inline("slack", "Slack")} and ${inline("linkedin", "LinkedIn")} coming soon. Real accounts, sending at the pace of the people who own them.</p>
        <div class="ctas"><a class="btn" href="${app}">Get started</a><button class="btn ghost" type="button" data-copy="${esc(mcp)}">${line(14, I.copy)}<span>Copy MCP URL</span></button></div>
      </div>
    </div>
    <div class="frame">${appFrame()}</div>
    <div class="clients"><span>Works with</span>${[["Claude", "Claude"], ["OpenAI", "ChatGPT"], ["Cursor", "Cursor"], ["OpenAI", "Codex"]].map(([t, n]) => `<span class="cw">${brand(t!)}<b>${n}</b></span>`).join("")}<span class="any">and any MCP client</span></div>
  </section>

  <section class="sec in" id="channels">
    <div class="sh"><h2>One integration.<br><span>Every inbox.</span></h2>
      <p>Your agent connects to Parley once. Each new channel shows up behind the same tools, so nothing in your agent changes when iMessage or Slack goes live.</p></div>
    <div class="chs">
      ${CHANNEL_LIST.map((c) => `<div class="ch${c.live ? " on" : ""}"><span class="ch-i">${LOGOS[c.id]!(24)}</span><div><b>${c.name}</b><p>${c.note}</p></div><span class="ch-b">${c.live ? "Live" : "Soon"}</span></div>`).join("")}
    </div>
  </section>

  <section class="sec in" id="how">
    <div class="sh"><h2>Agents move fast.<br><span>Accounts can't.</span></h2>
      <p>Personal accounts get restricted when they act like software. Parley sits between your agent and the account, and times every send the way a person would.</p></div>
    <div class="cards">
      <article class="card w2"><div class="card-v">${dayStrip()}<div class="stats"><div><b>08:00–21:00</b><span>in the account's time zone</span></div><div><b>30s – 2.5m</b><span>between sends, with breaks</span></div><div><b>40 → 300</b><span>replies a day as it warms up</span></div></div></div>
        <div class="card-t"><h3>Paced like a person</h3><p>Every message queues. Parley sends it inside the account's waking hours, spaced out, with breaks after bursts. New links start slow and earn higher limits only on days they use them.</p></div></article>
      <article class="card w1"><div class="card-v qr">${qr()}<ol><li>Settings</li><li>Linked devices</li><li>Link a device</li></ol></div>
        <div class="card-t"><h3>Real accounts, not bot numbers</h3><p>Link by QR as a companion device, the way WhatsApp Web works. Messages come from your number.</p></div></article>
      <article class="card"><div class="card-v ig">${[["Maya Okafor", 28, true], ["Family", 330, false], ["Product team", 150, true]].map(([n, h, on]) => `<div class="ig-r${on ? "" : " off"}">${av(String(n), Number(h), 26)}<b>${n}</b><span class="tg${on ? " on" : ""}"><i></i></span></div>`).join("")}</div>
        <div class="card-t"><h3>You decide what agents see</h3><p>Turn a chat off and Parley deletes what it stored from it. Agents never see it again.</p></div></article>
      <article class="card"><div class="card-v ob">
          <div class="ob-r"><span>Maya Okafor</span><time>08:12</time><em class="sent">Sent</em></div>
          <div class="ob-r"><span>Sam Reyes</span><time>08:14</time><em>Sending</em></div>
          <div class="ob-r"><span>Product team</span><time>08:15</time><button type="button" tabindex="-1">Cancel</button></div>
        </div>
        <div class="card-t"><h3>An outbox you can read</h3><p>See everything your agents queued and when it goes out. Cancel anything that hasn't sent.</p></div></article>
    </div>
    <ul class="facts">
      <li>${line(16, I.repeat)}<div><b>Never sends twice.</b> Retrying with the same idempotency key returns the original message.</div></li>
      <li>${line(16, I.lock)}<div><b>Sealed at rest.</b> Session keys are encrypted with AES-256-GCM.</div></li>
      <li>${line(16, I.plug)}<div><b>No API keys.</b> Agents sign in with OAuth, and you can cut any of them off.</div></li>
    </ul>
  </section>

  <section class="end in">
    <h2>Start with WhatsApp today.</h2>
    <p>iMessage, Slack and LinkedIn are next. Your agent won't need to change.</p>
    <div class="ctas"><a class="btn" href="${app}">Get started</a><a class="btn ghost" href="${gh}">View on GitHub</a></div>
  </section>
</main>

<footer class="foot"><div class="in">
  <a class="logo" href="/">${mark(16)}<span>Parley</span></a>
  <nav><a href="#channels">Channels</a><a href="#how">How it works</a><a href="${gh}">GitHub</a><a href="${app}">Log in</a></nav>
  <p>Source available under the Elastic License 2.0. Not affiliated with WhatsApp, Meta, Apple, Slack or LinkedIn.</p>
</div></footer>
<script>
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);const s=b.querySelector('span');s.textContent='Copied';setTimeout(()=>s.textContent='Copy MCP URL',1400)}catch(e){}}));
const nav=document.querySelector('.nav');addEventListener('scroll',()=>nav.classList.toggle('sc',scrollY>8),{passive:true});
</script>
</body></html>`
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#0d0c0a;--bg-1:#131210;--bg-2:#191815;--bg-3:#22201c;--bg-4:#2b2924;
  --line:rgba(255,246,232,.07);--line-2:rgba(255,246,232,.1);--line-3:rgba(255,246,232,.16);
  --text:#f3f0ea;--text-2:#d3cdc3;--muted:#9c958a;--faint:#6d675e;--warm:#e3b98d;
  --sans:'Inter',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,monospace;
  --ease:cubic-bezier(.2,.8,.2,1);color-scheme:dark;
}
html{scroll-behavior:smooth;scroll-padding-top:80px;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01","ss03";overflow-x:hidden}
a{color:inherit;text-decoration:none}
p,h1,h2,h3,ol,ul,dl,dd{margin:0;padding:0}
::selection{background:rgba(227,185,141,.28)}
:focus-visible{outline:2px solid var(--text-2);outline-offset:3px;border-radius:6px}
.in{max-width:1200px;margin:0 auto;padding-left:28px;padding-right:28px}

.logo{display:inline-flex;align-items:center;gap:9px;font-size:16px;font-weight:600;letter-spacing:-.02em}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 18px;border:0;border-radius:10px;background:var(--text);color:var(--bg);font:500 14.5px/1 var(--sans);letter-spacing:-.01em;cursor:pointer;white-space:nowrap;transition:background .2s var(--ease),transform .2s var(--ease)}
.btn:hover{background:#fff}.btn:active{transform:scale(.98)}
.btn.sm{height:32px;padding:0 13px;font-size:13.5px;border-radius:8px}
.btn.ghost{background:var(--bg-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--line-2)}.btn.ghost:hover{background:var(--bg-3)}

.nav{position:fixed;inset:0 0 auto;z-index:50;border-bottom:1px solid transparent;transition:background .2s,border-color .2s}
.nav.sc{background:rgba(13,12,10,.78);backdrop-filter:blur(14px) saturate(1.4);border-bottom-color:var(--line)}
.nav .in{height:60px;display:flex;align-items:center;gap:40px}
.nav nav{display:flex;gap:26px;font-size:13.5px;color:var(--muted)}.nav nav a:hover,.lnk:hover{color:var(--text)}
.nav-r{margin-left:auto;display:flex;align-items:center;gap:18px}.lnk{font-size:13.5px;color:var(--muted)}

/* Hero */
.hero{position:relative;padding-top:150px}
.hero::before{content:"";position:absolute;left:50%;top:0;width:1300px;height:760px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(255,236,210,.055),transparent);pointer-events:none}
.hero-t{position:relative}
.hero-r{display:flex;align-items:flex-end;justify-content:space-between;gap:48px;margin-top:28px}
.hero-r .lede{max-width:600px}
.hero-r .ctas{margin-top:0;flex:none}
.hero h1{font-size:clamp(40px,5.6vw,70px);line-height:1.03;font-weight:550;letter-spacing:-.04em;font-variation-settings:"opsz" 32}
.lede{font-size:17px;line-height:1.7;color:var(--muted);letter-spacing:-.005em}
.ic{display:inline-flex;align-items:center;gap:6px;color:var(--text);font-weight:500;white-space:nowrap;vertical-align:-2px}
.ic svg{border-radius:4px}
.ctas{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}
.frame{position:relative;margin-top:72px}
.frame::before{content:"";position:absolute;inset:-1px;border-radius:17px;background:linear-gradient(180deg,rgba(255,246,232,.16),rgba(255,246,232,.04) 30%,transparent 70%);pointer-events:none;z-index:1;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
.frame::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:180px;background:linear-gradient(transparent,var(--bg));pointer-events:none;z-index:2}
.clients{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:10px 10px;margin-top:8px;color:var(--muted);font-size:14px}
.clients > span:first-child{color:var(--faint);margin-right:14px}
.cw{display:inline-flex;align-items:center;gap:8px;margin-right:22px}.cw b{font-weight:500;color:var(--text-2)}
.clients .any{color:var(--faint)}

/* The app frame */
.app{display:grid;grid-template-columns:200px 290px minmax(0,1fr) 250px;height:600px;border-radius:16px;overflow:hidden;background:var(--bg-1);box-shadow:0 0 0 1px var(--line),0 50px 100px -40px rgba(0,0,0,.8);font-size:13px;line-height:1.45}
.sb{display:flex;flex-direction:column;gap:2px;padding:12px 10px;background:var(--bg);border-right:1px solid var(--line)}
.ws{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;margin-bottom:10px;color:var(--text-2)}.ws b{font-weight:500;color:var(--text)}.ws svg:last-child{color:var(--faint)}
.ws-m{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:var(--text);color:var(--bg)}
.sn{display:flex;flex-direction:column;gap:1px}
.sn a{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px;border-radius:7px;color:var(--text-2)}
.sn a.on{background:var(--bg-3);color:var(--text)}
.sn a svg{flex:none;color:var(--muted)}.sn a.on svg{color:var(--text)}
.sn a span{margin-left:auto;font-size:11.5px;color:var(--faint)}
.sn a em{margin-left:auto;font-style:normal;font-size:10.5px;color:var(--faint)}
.sn a.soon{color:var(--faint)}.sn a.soon svg{opacity:.5;filter:grayscale(.6)}
.dot{margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--warm);box-shadow:0 0 0 3px rgba(227,185,141,.14)}
.sl{font-size:11.5px;font-weight:500;color:var(--faint);padding:16px 8px 6px}
.ph{display:flex;align-items:center;gap:10px;height:48px;padding:0 16px;border-bottom:1px solid var(--line);flex:none}
.ph b{font-weight:500}
.seg{margin-left:auto;display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--bg-2);font-size:11.5px;color:var(--muted)}.seg span{padding:3px 8px;border-radius:6px}.seg .on{background:var(--bg-4);color:var(--text)}
.ls{display:flex;flex-direction:column;border-right:1px solid var(--line);min-width:0}
.li{display:flex;gap:11px;padding:12px 14px;border-bottom:1px solid var(--line)}
.li.on{background:var(--bg-2);box-shadow:inset 2px 0 0 var(--warm)}
.li-m{flex:1;min-width:0}.li-h{display:flex;justify-content:space-between;gap:8px}.li-h b{font-weight:500}.li-h time{font-size:11.5px;color:var(--faint)}
.li-m p{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.li-t{display:inline-flex;align-items:center;gap:5px;margin-top:7px;font-size:11px;color:var(--text-2);padding:2px 7px;border-radius:5px;background:var(--bg-3);box-shadow:inset 0 0 0 1px var(--line)}
.av{display:grid;place-items:center;flex:none;border-radius:50%;font-size:10.5px;font-weight:600;color:hsl(var(--h) 35% 80%);background:hsl(var(--h) 18% 22%)}
.th{display:flex;flex-direction:column;min-width:0;background:var(--bg-1)}
.th-h div{line-height:1.25}.th-h small{display:block;font-size:11.5px;color:var(--faint)}
.via{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);padding:3px 8px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line-2)}
.msgs{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:18px 22px}
.day{align-self:center;font-size:11px;color:var(--faint);margin:6px 0}
.m{display:flex;flex-direction:column;gap:3px;max-width:72%}
.m p{padding:8px 12px;border-radius:14px;font-size:13.5px}
.m time{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--faint);padding:0 4px}
.m.rx{align-self:flex-start}.m.rx p{background:var(--bg-3);border-bottom-left-radius:4px}
.m.tx{align-self:flex-end;align-items:flex-end}.m.tx p{background:var(--text);color:#1a1814;border-bottom-right-radius:4px}
.m.q p{background:transparent;color:var(--text-2);outline:1px dashed var(--line-3);outline-offset:-1px}
.tk{color:var(--muted);display:inline-flex}
.ev{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--muted);padding-left:4px}.ev b{font-weight:500;color:var(--text-2)}.ev time{color:var(--faint)}.ev svg{flex:none}
.cmp{display:flex;align-items:center;justify-content:space-between;margin:0 16px 16px;height:40px;padding:0 12px;border-radius:10px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--line);color:var(--faint)}
.cmp kbd{font:11px var(--sans);color:var(--faint);padding:2px 6px;border-radius:5px;box-shadow:inset 0 0 0 1px var(--line-2)}
.dt{border-left:1px solid var(--line);background:var(--bg);padding:6px 16px;overflow:hidden}
.dt .sl{padding:14px 0 10px}
.dt-s + .dt-s{border-top:1px solid var(--line);margin-top:10px}
.dt dl{display:grid;gap:9px;margin-bottom:14px}.dt dl div{display:flex;justify-content:space-between;gap:8px}.dt dt{color:var(--muted)}.dt dd{color:var(--text-2)}
.bar + .bar{margin-top:12px}
.bar-h{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}.bar-h b{color:var(--text);font-weight:500}
.bar-t{height:4px;margin-top:6px;border-radius:9px;background:var(--bg-3);overflow:hidden}.bar-t i{display:block;height:100%;border-radius:9px;background:var(--text-2)}
.vis{display:flex;align-items:center;justify-content:space-between;color:var(--text-2)}
.tg{position:relative;flex:none;width:30px;height:18px;border-radius:99px;background:var(--bg-4);box-shadow:inset 0 0 0 1px var(--line-2)}
.tg i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--muted);transition:left .2s}
.tg.on{background:var(--text);box-shadow:none}.tg.on i{left:14px;background:var(--bg)}

/* Day strip */
.ds-t{position:relative;height:44px;border-radius:9px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.ds-n{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,rgba(255,246,232,.05) 0 1px,transparent 1px 6px)}
.ds-w{position:absolute;top:0;bottom:0;background:rgba(255,246,232,.035);box-shadow:inset 1px 0 0 var(--line-3),inset -1px 0 0 var(--line-3)}
.ds-t i{position:absolute;top:10px;height:16px;width:1px;background:var(--text-2)}
.ds-t b{position:absolute;bottom:7px;width:5px;height:5px;margin-left:-2px;border-radius:50%;background:var(--warm)}
.ds-a{position:relative;height:16px;margin-top:7px;font-size:10.5px;color:var(--faint);font-variant-numeric:tabular-nums}
.ds-a span{position:absolute;top:0}.ds-a span:nth-child(2),.ds-a span:nth-child(3){transform:translateX(-50%)}.ds-a span:last-child{right:0}
.ds.mini .ds-t{height:30px}.ds.mini .ds-t i{top:7px;height:10px}.ds.mini .ds-t b{bottom:4px;width:4px;height:4px}.ds.mini .ds-a span:first-child,.ds.mini .ds-a span:last-child{display:none}

/* Sections */
.sec{padding-top:150px}
.sh{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:48px;align-items:end}
h2{font-size:clamp(32px,3.8vw,46px);line-height:1.08;font-weight:550;letter-spacing:-.035em}
h2 span{color:var(--faint)}
.sh p{font-size:16px;line-height:1.7;color:var(--muted);max-width:46ch}

.chs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:56px;border-top:1px solid var(--line);border-left:1px solid var(--line)}
.ch{display:flex;align-items:flex-start;gap:14px;padding:24px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transition:background .2s}
.ch:hover{background:var(--bg-1)}
.ch-i{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:11px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--line-2)}
.ch b{display:block;font-weight:500;font-size:15px}.ch p{font-size:13.5px;color:var(--muted);margin-top:2px}
.ch-b{margin-left:auto;font-size:11.5px;font-weight:500;color:var(--faint);padding:2px 8px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line-2);white-space:nowrap}
.ch.on .ch-b{color:var(--bg);background:var(--text);box-shadow:none}
.ch:not(.on) .ch-i svg{filter:grayscale(.7);opacity:.6;transition:filter .2s,opacity .2s}.ch:not(.on):hover .ch-i svg{filter:none;opacity:1}

.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:56px}
.card{grid-column:span 3}
.card{display:flex;flex-direction:column;border-radius:14px;background:var(--bg-1);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.card.w2{grid-column:span 4}.card.w1{grid-column:span 2}
.card-v{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:200px;padding:28px;border-bottom:1px solid var(--line);background:radial-gradient(100% 100% at 50% 0%,rgba(255,246,232,.03),transparent)}
.card-t{padding:22px 24px 24px}
.card h3{font-size:15.5px;font-weight:500;letter-spacing:-.015em}
.card-t p{margin-top:6px;font-size:14px;line-height:1.6;color:var(--muted);max-width:52ch}
.stats{display:grid;grid-template-columns:repeat(3,1fr);margin-top:24px}
.stats div + div{padding-left:20px;border-left:1px solid var(--line)}
.stats b{display:block;font-size:20px;font-weight:550;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.stats span{font-size:12.5px;color:var(--muted)}
.qr{flex-direction:row;align-items:center;gap:22px}.qr svg{border-radius:8px;flex:none}
.qr ol{list-style:none;counter-reset:s;display:grid;gap:8px;font-size:13px;color:var(--text-2)}
.qr li{counter-increment:s;display:flex;align-items:center;gap:9px}.qr li::before{content:counter(s);display:grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:10.5px;color:var(--muted);box-shadow:inset 0 0 0 1px var(--line-2)}
.ig{gap:6px}
.ig-r{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--line);font-size:13.5px}.ig-r b{flex:1;font-weight:500}
.ig-r.off b,.ig-r.off .av{opacity:.45}
.ob{gap:6px}
.ob-r{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--line);font-size:13.5px}
.ob-r span{flex:1;font-weight:500}.ob-r time{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.ob-r em{font-style:normal;font-size:11.5px;color:var(--muted);width:56px;text-align:right}.ob-r em.sent{color:var(--text-2)}
.ob-r button{width:56px;height:22px;border:0;border-radius:6px;background:var(--bg-4);color:var(--text-2);font:500 11px var(--sans)}
.facts{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;margin-top:40px}
.facts li{display:flex;gap:12px;font-size:14px;line-height:1.6;color:var(--muted)}.facts svg{flex:none;margin-top:2px;color:var(--text-2)}.facts b{font-weight:500;color:var(--text)}

.end{padding-top:180px;padding-bottom:160px;text-align:center;display:flex;flex-direction:column;align-items:center}
.end h2{font-size:clamp(36px,4.6vw,56px)}
.end p{margin-top:16px;font-size:16px;color:var(--muted)}
.end .ctas{justify-content:center;margin-top:30px}

.foot{border-top:1px solid var(--line)}
.foot .in{display:flex;flex-wrap:wrap;align-items:center;gap:16px 36px;padding-top:32px;padding-bottom:36px}
.foot .logo{font-size:15px;color:var(--text-2)}
.foot nav{display:flex;gap:22px;font-size:13.5px;color:var(--muted)}.foot nav a:hover{color:var(--text)}
.foot p{flex-basis:100%;font-size:12.5px;color:var(--faint)}

@media (prefers-reduced-motion:no-preference){
  .hero-t,.frame{animation:up .9s var(--ease) both}.frame{animation-delay:.12s}
  @keyframes up{from{opacity:0;transform:translateY(12px)}}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
@media (max-width:1120px){
  .app{grid-template-columns:190px 270px minmax(0,1fr)}.dt{display:none}
  .sh{grid-template-columns:1fr;gap:22px}
  .hero-r{flex-direction:column;align-items:flex-start;gap:26px}
}
@media (max-width:860px){
  .nav nav{display:none}
  .app{grid-template-columns:minmax(0,1fr);height:520px}.sb,.ls{display:none}
  .chs{grid-template-columns:1fr 1fr}
  .cards{grid-template-columns:1fr}.card,.card.w2,.card.w1{grid-column:auto}
  .facts{grid-template-columns:1fr;gap:16px}
}
@media (max-width:560px){
  .in{padding-left:18px;padding-right:18px}
  .hero{padding-top:112px}.lede{font-size:16px}
  .frame{margin-top:48px}
  .m{max-width:86%}
  .chs{grid-template-columns:1fr}
  .stats{grid-template-columns:1fr;gap:12px}.stats div + div{padding-left:0;border-left:0}
  .sec{padding-top:110px}
  .end{padding-top:120px;padding-bottom:110px}
}
`
