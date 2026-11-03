import type { Connection } from "../sessions/store.ts"

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

const LOGO = `<span class="logo">${tile("whatsapp", 24)}<span>Parley</span></span>`

/** Flage design tokens — Geist, 14px base, #FAFAFA page / #FFF cards, half-opacity borders, #171717 primary, sharp radii. */
const BASE_CSS = `
*{box-sizing:border-box}
:root{
  --bg:#fafafa;--surface:#fff;--surface-2:#f4f4f5;--text:#1a1a1a;--text-2:#4a4a4a;--muted:#8b8b90;
  --border:#ececec;--border-strong:#e2e2e2;--primary:#171717;--primary-ink:#fff;--accent:#16a34a;
  --radius:6px;--radius-lg:8px;--ease:cubic-bezier(.23,1,.32,1);--shadow:0 1px 2px rgba(0,0,0,.05);
  --font:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-decoration:none}
.wrap{max-width:60rem;margin:0 auto;padding:0 1.5rem}
.logo{display:inline-flex;align-items:center;gap:.5rem;font-weight:600;letter-spacing:-.01em;font-size:15px}
.tile{display:inline-grid;place-items:center;border-radius:7px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.04)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;height:32px;padding:0 12px;font-family:inherit;font-size:13px;font-weight:500;border-radius:var(--radius);border:1px solid transparent;background:var(--primary);color:var(--primary-ink);cursor:pointer;transition:background .12s var(--ease),transform .12s var(--ease),border-color .12s var(--ease);white-space:nowrap}
.btn:hover{background:#2a2a2a}.btn:active{transform:scale(.97)}
.btn svg{width:15px;height:15px}
.btn.outline{background:var(--surface);border-color:var(--border-strong);color:var(--text)}.btn.outline:hover{background:var(--surface-2)}
.btn.sm{height:28px;padding:0 10px;font-size:12px}
.muted{color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:.3rem;height:22px;padding:0 8px;font-size:12px;font-weight:500;border-radius:6px;border:1px solid var(--border-strong);color:var(--muted);background:var(--surface)}
.badge.on{color:var(--accent);border:0;background:rgba(22,163,74,.1)}
.badge svg{width:12px;height:12px}
.input{width:100%;height:36px;padding:0 10px;border-radius:var(--radius);border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font:inherit;outline:none}
.input:focus{border-color:#c4c4c4;box-shadow:0 0 0 3px rgba(23,23,23,.06)}
code{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--surface-2);border:1px solid var(--border);padding:.05em .3em;border-radius:4px}
`

const SHELL = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title>
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

function connectorCard(id: string, conn: Connection | undefined): string {
  const b = BRANDS[id]!
  let desc = b.tagline
  let left = ""
  let right = ""
  if (!b.live) {
    right = `<span class="badge">Soon</span>`
  } else if (conn?.status === "connected") {
    left = `<span class="badge on">${CHECK}Connected</span>`
    right = `<span class="muted" style="font-size:12px">${waNumber(conn.handle)}</span>`
  } else if (conn && (conn.status === "linking" || conn.status === "closed")) {
    left = `<span class="badge">Waiting for scan</span>`
    right = `<a class="btn sm outline" href="/link/${conn.id}">Finish linking</a>`
  } else {
    left = `<span class="badge">Not connected</span>`
    right = `<form method="post" action="/app/connect"><button class="btn sm" type="submit">Connect</button></form>`
  }
  return `<article class="cc${b.live ? "" : " soon"}">
    <div class="cc-row">${tile(id, 32)}<div class="cc-info"><p class="cc-name">${b.name}</p><p class="cc-desc">${desc}</p></div></div>
    <div class="cc-foot">${left}${right}</div>
  </article>`
}

export function dashboardPage(opts: { connections: Connection[] }): string {
  const byChannel = new Map<string, Connection>()
  for (const c of opts.connections) if (!byChannel.has(c.channel)) byChannel.set(c.channel, c)
  const available = Object.keys(BRANDS).filter((id) => BRANDS[id]!.live).map((id) => connectorCard(id, byChannel.get(id))).join("")
  const soon = Object.keys(BRANDS).filter((id) => !BRANDS[id]!.live).map((id) => connectorCard(id, undefined)).join("")

  return SHELL(
    "Parley · Connectors",
    `<style>
      .top{display:flex;align-items:center;justify-content:space-between;height:56px}
      main.wrap{padding-bottom:64px}
      .title{font-size:20px;line-height:28px;letter-spacing:-.012em;font-weight:600;margin:14px 0 2px}
      .title + p{margin:0;color:var(--muted);font-size:13px}
      .sec{margin:28px 0 12px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:12px}
      .cc{display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
      .cc.soon{opacity:.7}
      .cc-row{display:flex;align-items:center;gap:10px;min-width:0}
      .cc-info{flex:1;min-width:0}
      .cc-name{margin:0;font-weight:500;font-size:14px}
      .cc-desc{margin:1px 0 0;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cc-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}
      .cc-foot:has(.badge:only-child),.cc.soon .cc-foot{justify-content:flex-end}
    </style>
    <div class="wrap"><header class="top">${LOGO}
      <form method="post" action="/auth/signout"><button class="btn outline sm" type="submit">Sign out</button></form></header></div>
    <main class="wrap">
      <h1 class="title">Connectors</h1><p>Link a messaging account; your agents use it over MCP.</p>
      <div class="sec">Available</div>
      <div class="grid">${available}</div>
      <div class="sec">Coming soon</div>
      <div class="grid">${soon}</div>
    </main>`
  )
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
        if(d.status==='connected'){title.textContent='Connected';card.innerHTML='<div class="ok">✓</div><p class="step"><b>'+((d.channel||'Channel').replace(/^./,x=>x.toUpperCase()))+' is linked.</b> You can close this tab — your agents can use it now.</p>';return true}
        if(d.qr_svg){title.textContent='Scan to link';card.innerHTML='<div class="qr">'+d.qr_svg+'</div><ol class="ol"><li>Open WhatsApp on your phone</li><li>Settings → <b>Linked devices</b></li><li><b>Link a device</b>, then scan this code</li></ol>';return false}
        card.innerHTML='<div class="spin"></div><p class="step">Preparing a secure link…</p>';return false
      }
      async function tick(){try{const r=await fetch('/link/'+id+'/status');if(r.ok){if(render(await r.json()))return}}catch(e){}setTimeout(tick,2000)}
      tick();
    </script>`
  )
}
