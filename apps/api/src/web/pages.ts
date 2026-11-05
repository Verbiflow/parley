import { parsePhoneNumberFromString } from "libphonenumber-js"
import { policyFor } from "@parley/pacing"
import type { Connection } from "../sessions/store.ts"
import type { ChatRow } from "../sessions/chats.ts"
import { MAX_GAP_SECONDS, UNSEND_WINDOW_MS, type ActivityEntry, type ActivityPage, type ActivityStatus, type DailyUsage, type Outbound } from "../sessions/outbox.ts"
import type { Exit, Provider } from "../sessions/exits.ts"
import { EVENT_TEXT, MAX_ATTEMPTS, MAX_WEBHOOKS, WEBHOOK_EVENTS, type Delivery, type Webhook } from "../sessions/webhooks.ts"
import {
  CHANNELS, LOGO, agentMark, agentRow, ago, appShell, avatar, bar, channelMark, channelName, profileMark, clock, copyLine, day, empty, esc, glyph, icon,
  foldSection, orb, pageHead, pmark, section, shell, SHOW_NETWORK, soonMark, soonTip, stamp, status, until, type Tone, type Viewer,
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
const KIND_LABEL: Record<string, string> = { message: "Reply", first_message: "Opener", invite: "Invite" }
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

function connectionState(c: Connection): { tone: Tone; text: string } {
  if (c.status === "connected" && c.haltedReason) return { tone: "bad", text: "halted" }
  if (c.status === "connected" && c.pausedUntil) return { tone: "warn", text: "backing off" }
  if (c.status === "connected") return { tone: "ok", text: "live" }
  if (c.status === "linking" || c.status === "closed") return { tone: "info", text: "waiting for scan" }
  if (c.status === "logged_out") return { tone: "idle", text: "disconnected" }
  return { tone: "bad", text: "error" }
}


// ---- Signed out ---------------------------------------------------------------------------------------------------

/** Google's "G" mark, for the sign-in button (sign-in goes straight to Google; see /auth/start). */
const GOOGLE_G = `<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style="margin-right:8px;vertical-align:-3px"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`

/** The app's signed-out page (app.itsparley.com): the site's threads behind one centered panel, straight to Google. */
export function landingPage(opts: { workos: boolean; dev: boolean }): string {
  const dev = `<form method="post" action="/auth/dev" class="dev">
      <input class="input" name="email" type="email" placeholder="you@example.com" required autocomplete="email" aria-label="Email">
      <button class="btn lg block" type="submit">Continue with email</button>
      <p class="hint">Local development: any email signs you in.</p></form>`
  const panel = opts.workos
    ? `<a class="btn lg block" href="/auth/start">${GOOGLE_G}Continue with Google</a>${opts.dev ? `<div class="or label">or</div>${dev}` : ""}`
    : opts.dev ? dev
    : `<p class="hint">Sign-in isn't set up on this server yet. Its operator needs to add WorkOS keys.</p>`
  return shell("Sign in · Parley", `
    <canvas class="threads" aria-hidden="true"></canvas>
    <main class="signin">
      ${pmark(52)}
      <h1>Your messaging, ready for your agents.</h1>
      <p class="sub">Link your accounts once. Your agents text people as you, at a human pace, with every message on record.</p>
      <section class="panel">${panel}</section>
      <div class="chans"><span class="label">Channels</span>${Object.entries(CHANNELS).map(([id, c]) => c.live ? `<span title="${c.name}">${channelMark(id, 18)}</span>` : soonMark(id, 18)).join("")}</div>
    </main>
    <p class="foot"><a href="https://itsparley.com">itsparley.com</a><span>·</span><a href="https://github.com/Verbiflow/parley">GitHub</a></p>`, { css: SIGNIN_CSS, script: THREADS_SCRIPT })
}

const SIGNIN_CSS = `
body::before{display:none}
.threads{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 1.2s var(--ease)}.threads.on{opacity:1}
.signin::before{content:"";position:absolute;left:50%;top:50%;width:min(760px,110vw);height:600px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,var(--bg) 48%,color-mix(in srgb,var(--bg) 82%,transparent) 68%,transparent);pointer-events:none;z-index:-1}
.signin{position:relative;isolation:isolate;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.5rem 4rem}
.signin .pmark{margin-bottom:26px}
.signin h1{font-size:34px;line-height:40px;font-weight:400;letter-spacing:-.035em;margin:0;max-width:16ch;text-wrap:balance}
.signin .sub{font-size:15px;line-height:24px;color:var(--muted);max-width:40ch;margin:14px 0 0;text-wrap:balance}
.signin .panel{width:100%;max-width:300px;margin-top:30px;display:flex;flex-direction:column;gap:12px;text-align:left}
.chans{display:flex;align-items:center;gap:14px;margin-top:36px}.chans .label{margin-right:4px;color:var(--faint)}.chans span{display:inline-flex}
.dev{display:flex;flex-direction:column;gap:10px}.dev .input{height:40px;border-radius:999px;padding:0 16px;text-align:center}
.signin .hint{font-size:12.5px;line-height:19px;color:var(--faint);text-align:center;text-wrap:balance}
.or{display:flex;align-items:center;gap:10px;color:var(--faint)}.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
.foot{position:absolute;bottom:22px;left:0;right:0;display:flex;justify-content:center;gap:10px;font-size:12.5px;color:var(--faint)}.foot a:hover{color:var(--text-2)}
`

/**
 * The site's hero background: message threads drawn in from the left, pinched through Parley's mark, fanned out to the
 * right, with a few pulses running along them. Canvas 2D; pauses when the tab is hidden; still for reduced motion.
 */
const THREADS_SCRIPT = `(()=>{const c=document.querySelector('canvas.threads'),m=document.querySelector('.pmark');if(!c||!m)return;const x=c.getContext('2d');if(!x)return;
const N=44,still=matchMedia('(prefers-reduced-motion: reduce)').matches;let w=0,h=0,px=0,py=0,f=0,last=performance.now();const t0=last;
const pulses=Array.from({length:7},(_,k)=>({l:(k*23)%N,u:k/7,s:.05+(k%3)*.016}));
const L=matchMedia('(prefers-color-scheme: light)');let P;const pal=()=>{P=L.matches?{a:'150,96,52',b:'128,76,38',p:'163,101,58',k:.8,op:'source-over'}:{a:'227,185,141',b:'240,205,165',p:'248,214,172',k:1,op:'lighter'}};pal();
const rgba=(c,al)=>'rgba('+c+','+al*P.k+')';
function size(){const d=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*d;c.height=h*d;x.setTransform(d,0,0,d,0,0);const r=m.getBoundingClientRect();px=r.left+r.width/2;py=r.top+r.height/2}
function curve(i,t){const g=i/(N-1),s=Math.sin(t*.35+g*5.5)*.02,sp=(g-.5)*h;return[[-.06*w,h*(-.15+1.3*g+s)],[px-w*.2,py+sp*(.08+s)],[px+w*.2,py+sp*(.05-s)],[1.06*w,h*(-.2+1.35*g-s)]]}
function at(p,u){const v=1-u;return[0,1].map(k=>v*v*v*p[0][k]+3*v*v*u*p[1][k]+3*v*u*u*p[2][k]+u*u*u*p[3][k])}
function draw(now){const t=(now-t0)/1000+12,dt=Math.min((now-last)/1000,.05);last=now;x.clearRect(0,0,w,h);const q=px/w;
const g=x.createLinearGradient(0,0,w,0);g.addColorStop(0,rgba(P.a,0));g.addColorStop(Math.max(q-.3,.02),rgba(P.a,.06));g.addColorStop(q,rgba(P.b,.42));g.addColorStop(Math.min(q+.3,.98),rgba(P.a,.08));g.addColorStop(1,rgba(P.a,0));
x.strokeStyle=g;x.lineWidth=.75;x.beginPath();for(let i=0;i<N;i++){const p=curve(i,t);x.moveTo(p[0][0],p[0][1]);x.bezierCurveTo(p[1][0],p[1][1],p[2][0],p[2][1],p[3][0],p[3][1])}x.stroke();
x.globalCompositeOperation=P.op;for(const p of pulses){if(!still)p.u+=p.s*dt;if(p.u>1.05){p.u=-.05;p.l=(p.l+17)%N}const cv=curve(p.l,t),hd=Math.min(Math.max(p.u,0),1),tl=Math.max(hd-.07,0),a=Math.sin(Math.PI*hd);
for(const[lw,al]of[[3,.1],[1.2,.75]]){x.beginPath();for(let k=0;k<=10;k++){const[X,Y]=at(cv,tl+(hd-tl)*k/10);k?x.lineTo(X,Y):x.moveTo(X,Y)}x.strokeStyle=rgba(P.p,al*a);x.lineWidth=lw;x.stroke()}}
x.globalCompositeOperation='source-over';c.classList.add('on');if(!still&&!document.hidden)f=requestAnimationFrame(draw)}
const go=()=>{cancelAnimationFrame(f);last=performance.now();f=requestAnimationFrame(draw)};size();go();addEventListener('resize',()=>{size();go()});document.addEventListener('visibilitychange',()=>!document.hidden&&go());L.addEventListener('change',()=>{pal();go()})})();`

// ---- Overview -----------------------------------------------------------------------------------------------------

const isActive = (a: AgentView) => Boolean(a.lastUsedAt && Date.now() - Date.parse(a.lastUsedAt) < 120_000)

const OVERVIEW_CSS = `
.chan td:first-child{padding-left:0}
.chtags{display:flex;flex-wrap:wrap;gap:6px;margin-right:6px}
.chtag{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px 0 10px;border:0;border-radius:999px;background:var(--glass);box-shadow:var(--glass-ring);font-size:12.5px;color:var(--text-2);white-space:nowrap}
button.chtag{cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease)}button.chtag:hover{color:var(--text);background:var(--glass-hi)}
.chtag.soon{background:none;box-shadow:inset 0 0 0 1px var(--line);color:var(--muted)}.chtag i{font-style:normal;font-size:11.5px;color:var(--faint);margin-left:2px}
.conns{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:12px;padding-top:18px}
.conn{position:relative;display:flex;flex-direction:column;gap:16px;padding:18px;border-radius:16px;background:var(--card);box-shadow:var(--frame);transition:box-shadow .2s var(--ease),transform .2s var(--ease)}
.conn .ct{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:13px;background:var(--glass);box-shadow:var(--glass-ring)}
.conn b{display:block;font-size:15px;font-weight:500;letter-spacing:-.01em;color:var(--text)}
.conn small{display:block;font-size:12.5px;line-height:18px;color:var(--muted);margin-top:3px}
.conn .cf{margin-top:auto}
.conn.ready{box-shadow:var(--frame),0 0 0 1px var(--accent-ring)}
.conn.ready::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(80% 60% at 20% 0%,var(--lit),transparent 70%);pointer-events:none}
.conn.ready .btn{width:100%}
.conn.later{display:flex;background:transparent;box-shadow:inset 0 0 0 1px var(--line)}.conn.later b{color:var(--text-2)}.conn.later small{color:var(--faint)}
.conn.later:hover,.conn.later:focus-visible{box-shadow:inset 0 0 0 1px var(--line-2)}
.conns.compact .conn{flex-direction:row;align-items:center;padding:12px 14px;gap:12px}
.conns.compact .conn .ct{width:34px;height:34px;border-radius:10px}.conns.compact .conn small{display:none}.conns.compact .conn b{font-size:13.5px}
.conns.compact .conn .cf{margin:0 0 0 auto}.conns.compact .conn.ready .btn{width:auto}
.stepn{display:inline-grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--line-3);font-size:11.5px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;color:var(--text);margin-right:11px}
.stepn.done{background:var(--primary);box-shadow:var(--primary-shadow);color:var(--on-primary)}
.done-tag{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px 0 8px;border-radius:999px;background:color-mix(in srgb,var(--sand) 12%,transparent);color:var(--sand);font-size:12px;font-weight:500}
.seg button .cm,.seg button svg{margin-right:7px}
.mcp{display:flex;flex-direction:column;gap:16px;padding-top:18px}
.mcp .tabrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pane{display:flex;flex-direction:column;gap:12px;font-size:13.5px;color:var(--muted);line-height:22px}
.pane ol{margin:0;padding-left:20px}.pane b{color:var(--text);font-weight:500}.pane code{color:var(--text-2)}
.any{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.marks{display:inline-flex;align-items:center}
.marks span{display:inline-grid;place-items:center;width:28px;height:28px;margin-left:-6px;border-radius:50%;background:var(--card);box-shadow:var(--glass-ring),0 0 0 2px var(--bg);color:var(--text)}.marks span:first-child{margin-left:0}
.accounts{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding-top:18px}
.acard{position:relative;display:flex;flex-direction:column;gap:18px;padding:18px 18px 16px;border-radius:18px;background:var(--card);box-shadow:var(--frame);transition:transform .2s var(--ease),box-shadow .2s var(--ease)}
.acard::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(90% 80% at 0% 0%,var(--lit),transparent 62%);pointer-events:none}
.acard .cover{position:absolute;inset:0;border-radius:inherit;z-index:1}
.acard .awh{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--muted);padding-top:12px;border-top:1px solid var(--line)}
.acard .awh .m{font-family:var(--mono);color:var(--text-2)}.acard .awh .cfg{display:inline-flex;gap:5px;align-items:center;color:var(--text)}.acard .awh:hover .cfg,.acard .awh:hover .m{text-decoration:underline;text-underline-offset:3px}
.acard:not(.add):hover{transform:translateY(-2px);box-shadow:var(--frame),0 0 0 1px var(--line-2),var(--deep)}
.acard .ah{position:relative;display:flex;align-items:center;gap:12px}
.acard .ct{display:inline-grid;place-items:center;flex:none;width:40px;height:40px;border-radius:12px;background:var(--glass);box-shadow:var(--glass-ring)}
.acard .grow{flex:1;min-width:0}
.acard b{display:block;font-size:15px;font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acard small{display:block;font-size:12.5px;color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acard .ab .row{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;color:var(--muted);margin-bottom:9px}
.acard .ab .m{font-family:var(--mono);font-size:12.5px;color:var(--text-2)}
.acard .bar{display:block;width:100%;height:5px}
.acard .af{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.acard .next{display:inline-flex;align-items:center;gap:8px;color:var(--text-2)}
.acard .go{display:inline-flex;align-items:center;gap:6px;color:var(--text-2);white-space:nowrap;transition:color .15s}a.acard:hover .go{color:var(--text)}
.acard .go svg{transition:transform .15s var(--ease)}.acard:not(.add):hover .go svg{transform:translateX(2px)}
.acard.add{background:transparent;box-shadow:inset 0 0 0 1px var(--line-2)}.acard.add::before{opacity:.6}
.acard.add .ct{background:var(--glass);box-shadow:var(--glass-ring);color:var(--text-2)}
.acard .soon{display:inline-flex;align-items:center;gap:9px}.acard .soon span{display:inline-flex}
.agentc{display:flex;flex-direction:column;gap:20px;padding-top:20px}
.cgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px}
.cc{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:18px;background:var(--card);box-shadow:var(--frame)}
.cc .cl{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500;color:var(--text)}.cc .cl svg{color:var(--sand)}
.cc p{font-size:13px;line-height:20px;color:var(--muted)}
.works{margin-top:auto;padding-top:6px;display:flex;flex-direction:column;gap:10px}.works > span{font-size:12px;color:var(--faint)}
.works .arow{gap:6px}.works .arow li{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--glass);box-shadow:var(--glass-ring);color:var(--text-2)}.works .arow li:hover{color:var(--text)}
@media (max-width:860px){.cgrid{grid-template-columns:1fr}}

/* activity: one table on a lit card, a line per day, new and changed lines glowing in as they arrive */
.sec .atable{margin-top:16px}
.atable{border-radius:18px;background:var(--card);box-shadow:var(--frame);overflow:hidden}
.atbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}
.atbl col.c-t{width:90px}.atbl col.c-s{width:166px}.atbl col.c-ag{width:136px}.atbl col.c-fr{width:148px}.atbl col.c-to{width:160px}.atbl col.c-x{width:96px}
.atbl th{height:40px;padding:0 12px;text-align:left;font-size:12px;font-weight:400;color:var(--faint);background:var(--row);border-bottom:1px solid var(--line);white-space:nowrap}
.atbl td{height:50px;padding:0 12px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atbl th:first-child,.atbl td:first-child{padding-left:20px}.atbl th:last-child,.atbl td:last-child{padding-right:20px}
.atbl tbody tr:last-child td{border-bottom:0}
.atbl tr.e{transition:background .15s var(--ease)}.atbl tr.e:hover{background:var(--hover)}
.atbl tr.dh td{height:36px;padding-top:12px;padding-bottom:6px;vertical-align:bottom;font-size:12px;font-weight:500;letter-spacing:.01em;color:var(--muted);background:linear-gradient(180deg,var(--row),transparent)}
.atbl tr.none td{height:auto;padding:36px 20px;white-space:normal;text-align:center;font-size:13.5px;color:var(--muted)}
.atbl .t{font-family:var(--mono);font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.atbl .s{overflow:visible}.atbl .sw{margin-left:8px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.atbl .ag{color:var(--text-2)}.atbl .ag > *{vertical-align:middle}.atbl .ag .glyph{margin-right:9px;width:20px;height:20px;border-radius:6px}
.atbl .ag .glyph.you{background:var(--glass);box-shadow:var(--glass-ring);color:var(--muted)}
.atbl .fr{font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.atbl .to{font-family:var(--mono);font-size:12.5px;color:var(--text);font-variant-numeric:tabular-nums}
.atbl .b{color:var(--text-2)}.atbl .b > span{display:block;overflow:hidden;text-overflow:ellipsis}
.atbl .b .err{margin-top:2px;font-size:12px;color:color-mix(in srgb,var(--bad) 55%,var(--muted))}
.atbl .tag{display:inline-flex;align-items:center;height:18px;padding:0 7px;margin-right:8px;border-radius:6px;font-size:11px;font-weight:500;color:var(--sand);background:color-mix(in srgb,var(--sand) 10%,transparent);vertical-align:1px}
.atbl .x{text-align:right;overflow:visible;text-overflow:clip}.atbl .x form{display:inline}.atbl .x .btn{margin-right:-8px}
.atbl .x .later{opacity:0;transition:opacity .15s var(--ease)}.atbl tr.e:hover .x .later,.atbl .x .later:focus-within{opacity:1}
.atbl tr.fresh{animation:fresh 2.6s var(--ease)}.atbl tr.fresh td{animation:fresh-in .5s var(--ease)}
@keyframes fresh{from{background:color-mix(in srgb,var(--sand) 10%,transparent)}to{background:transparent}}
@keyframes fresh-in{from{opacity:0}}
.livei{display:none;font-size:12.5px;color:var(--muted)}.livei.off{display:inline}
.sec-h .aside .all{display:inline-flex;align-items:center;gap:5px}
.atools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.atools .seg a{gap:7px}.atools .seg .c{font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}.atools .seg .on .c{color:var(--text-2)}
.atools .fl{display:flex;align-items:center;gap:8px}
.atools .select{height:34px;width:auto;min-width:170px;border-radius:999px;font-variant-numeric:tabular-nums}
.search{position:relative;display:block}.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--faint);pointer-events:none}
.search .input{width:250px;height:34px;padding-left:34px;border-radius:999px}
.search .input::-webkit-search-cancel-button{filter:grayscale(1) opacity(.5)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:0 4px;font-size:12.5px;color:var(--muted)}
.pager b{font-weight:500;color:var(--text-2);font-variant-numeric:tabular-nums}
.pager .pp{display:flex;align-items:center;gap:6px}.pager .pn{margin-right:8px;color:var(--faint)}
.pager .btn.off{opacity:.38;pointer-events:none}
@media (max-width:760px){
  .atbl,.atbl tbody{display:block}.atbl thead,.atbl colgroup{display:none}
  .atbl tr.e{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:14px 16px;border-bottom:1px solid var(--line)}
  .atbl tr.e td{display:block;height:auto;padding:0!important;border:0}
  .atbl td.to{order:1;flex:1 1 auto;min-width:0}.atbl td.s{order:2}.atbl td.b{order:3;flex:1 0 100%;white-space:normal}.atbl td.b > span{white-space:nowrap}
  .atbl td.t{order:4}.atbl td.ag{order:5;font-size:12px}.atbl td.fr{order:6}.atbl td.x{order:7;margin-left:auto}.atbl .x .later{opacity:1}
  .atbl tr.dh{display:block}.atbl tr.dh td{display:block;height:auto;padding:14px 16px 6px!important}
  .atbl tr.none{display:block}.atbl tr.none td{display:block}
  .atools{flex-direction:column;align-items:stretch}.atools .seg{overflow-x:auto;scrollbar-width:none}.atools .fl{flex-wrap:wrap}.search,.search .input{width:100%}.atools .fl .select{flex:1}
  .pager{flex-direction:column;align-items:flex-start}
}
`

const connectForm = (label: string, cls = "btn") => `<form method="post" action="/app/connect" data-locale style="display:contents"><input type="hidden" name="timezone"><input type="hidden" name="country"><button class="${cls}" type="submit">${icon("plus", 13)}${label}</button></form>`

/** One card per channel, for the first link: the live ones get a Connect button, the rest stay dim until hovered. */
function connectorCards(resume: Connection | undefined): string {
  return `<div class="conns">${Object.entries(CHANNELS).map(([id, c]) => c.live
    ? `<div class="conn ready">
      <span class="ct">${channelMark(id, 26)}</span>
      <div><b>${c.name}</b><small>${esc(c.tagline)}</small></div>
      <div class="cf">${resume?.channel === id ? finishLink(resume, "btn") : connectForm(`Connect ${c.name}`, "btn")}</div>
    </div>`
    : `<div class="conn later soon-x" tabindex="0" aria-label="${c.name}, coming soon">
      <span class="ct">${channelMark(id, 26)}</span>
      <div><b>${c.name}</b><small>${esc(c.tagline)}</small></div>
      ${soonTip(id)}
    </div>`).join("")}</div>`
}

const cityOf = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ")

/** A linked (or linking) account: who it sends as, today against its limit, what's next, and its chats. */
function accountCard(c: Connection, s: ConnectionSummary | undefined, chats: number | undefined, webhooks: number): string {
  const st = connectionState(c)
  const number = waNumber(c.handle) || channelName(c.channel)
  const live = c.status === "connected"
  const href = live ? `/app/connections/${esc(c.id)}` : `/link/${esc(c.id)}`
  const body = live && s
    ? `<div class="ab"><div class="row"><span>Today</span><span class="m">${s.sentToday}<span class="faint"> / ${s.dailyLimit}</span></span></div>${bar(s.sentToday, s.dailyLimit)}</div>
       <div class="af"><span class="next">${s.nextAt ? `${s.queued} queued · next ${esc(until(s.nextAt, c.timezone))}` : `<span class="faint">Nothing queued</span>`}</span><span class="go">${chats ?? 0} chats ${icon("arrow", 13)}</span></div>`
    : `<div class="af"><span class="faint">${live ? "Loading today's numbers" : "Waiting for the QR scan"}</span><span class="go">${live ? "Open" : "Finish linking"} ${icon("arrow", 13)}</span></div>`
  // The card is one link; the webhooks line is its own (above the card's link), straight to the number's webhooks.
  const hooks = live
    ? `<a class="awh" href="/app/connections/${esc(c.id)}#webhooks"><span>Webhooks</span>${webhooks ? `<span class="m">${webhooks}</span>` : `<span class="cfg">Configure ${icon("arrow", 12)}</span>`}</a>`
    : ""
  return `<div class="acard"><a class="cover" href="${href}" aria-label="${esc(number)}"></a>
    <div class="ah">${c.avatar
      ? profileMark(c.channel, c.avatar, 40)
      : `<span class="ct">${channelMark(c.channel, 20)}</span>`}<div class="grow"><b>${esc(number)}</b><small>${channelName(c.channel)}${c.displayName ? ` · ${esc(c.displayName)}` : ""} · ${esc(cityOf(c.timezone))}</small></div>${status(st.tone, st.text)}</div>
    ${body}
    ${hooks}
  </div>`
}

/** A link someone started and never scanned: not an account yet, just where the next "Connect" picks up. */
export const unfinishedLink = (c: Connection) => !c.handle && (c.status === "linking" || c.status === "closed")

const finishLink = (c: Connection, cls: string) => `<a class="${cls}" href="/link/${esc(c.id)}">Finish linking<span class="ar">${icon("arrow", 13)}</span></a>`

/** The last card in the grid: link another number now (or finish the one started), and the channels on their way. */
const addCard = (resume: Connection | undefined) => `<div class="acard add">
    <div class="ah"><span class="ct">${icon("plus", 18)}</span><div class="grow"><b>Connect an account</b><small>${resume ? "You started linking a number" : "Link another number"}</small></div></div>
    <div class="af">${resume ? finishLink(resume, "btn sm") : connectForm("Connect WhatsApp", "btn sm")}<span class="soon">${Object.entries(CHANNELS).filter(([, c]) => !c.live).map(([id]) => soonMark(id, 16)).join("")}</span></div>
  </div>`

const stepNo = (n: number, done: boolean) => `<span class="stepn${done ? " done" : ""}">${done ? icon("check", 11, 2.5) : n}</span>`
const doneTag = `<span class="done-tag">${icon("check", 12, 2.25)}Done</span>`

/** What to paste into any agent: the endpoint, how it signs in, and a first call to check it worked. */
const installPrompt = (mcpUrl: string) =>
  `Add the Parley MCP server so you can read and send my messages. It's a remote MCP server (Streamable HTTP) at ${mcpUrl} and signs in with OAuth: open the sign-in link it gives you and wait for me to approve. Once it's connected, call list_connections and tell me which accounts you can use.`

/** How to connect an agent: every agent the site lists, the URL, and one prompt that works in all of them. */
function agentSetup(mcpUrl: string, agents: AgentView[]): string {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(mcpUrl)
  return `<div class="agentc">
      <div class="cgrid">
        <div class="cc"><span class="cl">Your MCP server</span>${copyLine(mcpUrl)}<p>A remote MCP server (Streamable HTTP). It signs in with OAuth in your browser, so there's no key to paste.</p>
          <div class="works"><span>Works with</span>${agentRow(16)}</div></div>
        <div class="cc"><span class="cl">Paste this into your agent</span>${copyLine(installPrompt(mcpUrl), { wrap: true })}
          <p>Claude, ChatGPT and Cursor connect from their settings instead: add the URL as a custom connector or MCP server, then sign in. In a terminal: <code>claude mcp add --transport http parley ${esc(mcpUrl)}</code>.${local ? " Apps that reach it from their own servers need a public URL: set <code>PUBLIC_URL</code> behind a tunnel." : ""}</p></div>
      </div>
    </div>`
}

const MEDIA_LABEL: Record<string, string> = { image: "Photo", video: "Video", audio: "Voice note", document: "Document" }
/** How a queued send reads in a list: its text, with what it carries when it's a file or a reaction. */
function outText(m: Outbound): string {
  if (m.unsend) return "Deleted a message for everyone"
  if (m.reactTo) return m.text ? `Reacted ${m.text}` : "Took back a reaction"
  if (m.media) return `${m.media.kind === "document" && m.media.fileName ? m.media.fileName : MEDIA_LABEL[m.media.kind] ?? m.media.kind}${m.text ? ` · ${m.text}` : ""}`
  return m.text
}

// ---- Activity -----------------------------------------------------------------------------------------------------

export type ActivityFilter = { status?: ActivityStatus | undefined; account?: string | undefined; q?: string | undefined }
export const ACTIVITY_PER_PAGE = 50
const ACTIVITY_TABS: [ActivityStatus | undefined, string][] = [[undefined, "All"], ["sent", "Sent"], ["queued", "Queued"], ["failed", "Failed"], ["canceled", "Canceled"]]

/** "/app/activity?status=sent&q=…": the filter (and page) as a query string, leaving out what isn't set. */
export function activityQuery(f: ActivityFilter & { page?: number; compact?: boolean }): string {
  const p = new URLSearchParams()
  if (f.status) p.set("status", f.status)
  if (f.account) p.set("account", f.account)
  if (f.q) p.set("q", f.q)
  if (f.page && f.page > 1) p.set("page", String(f.page))
  if (f.compact) p.set("compact", "1")
  const s = p.toString()
  return s ? `?${s}` : ""
}

const ymd = (d: Date, timeZone: string) => d.toLocaleDateString("en-CA", { timeZone })
/** "Today", "Yesterday", "Mon, Oct 26": the day a line happened, on the account's own calendar. */
function dayLabel(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const key = ymd(d, timeZone)
  if (key === ymd(new Date(), timeZone)) return "Today"
  if (key === ymd(new Date(Date.now() - 86_400_000), timeZone)) return "Yesterday"
  const thisYear = key.slice(0, 4) === ymd(new Date(), timeZone).slice(0, 4)
  return d.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) })
}

function entryState(m: Outbound, tz: string): string {
  if (m.status === "sent") return status("ok", m.attempts > 1 ? `Sent · try ${m.attempts}` : "Sent")
  if (m.status === "failed") {
    if (m.error?.code === "outcome_unknown") return status("warn", "Interrupted")
    return status("bad", m.error?.code === "recipient_unavailable" ? "Not on WhatsApp" : "Failed")
  }
  if (m.status === "canceled") return status("idle", "Canceled")
  if (m.status === "sending") return status("info", "Sending")
  return `${status("info", "Queued")}<span class="sw">${m.scheduledFor ? esc(until(m.scheduledFor, tz)) : "held"}</span>`
}

const ERROR_TEXT: Record<string, string> = {
  outcome_unknown: "The connection dropped mid-send, so it may or may not have gone out. Parley won't retry it.",
  recipient_unavailable: "That number isn't on WhatsApp.",
}

type ActivityCtx = { tz: Map<string, string>; from?: Map<string, string> | undefined; actions: boolean; back: string }
const activityCols = (c: ActivityCtx) => 5 + (c.from ? 1 : 0) + (c.actions ? 1 : 0)

function activityRow(m: ActivityEntry, c: ActivityCtx): string {
  const tz = c.tz.get(m.connectionId) ?? "UTC"
  const full = new Date(m.at).toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "medium" })
  const who = m.agent ? `${agentMark(m.agent, 20)}<span>${esc(m.agent)}</span>` : `<span class="glyph you" aria-hidden="true">${icon("user", 11)}</span><span>You</span>`
  const err = m.status === "failed" && m.error ? `<span class="err">${esc(ERROR_TEXT[m.error.code] ?? m.error.message)}</span>` : ""
  const text = outText(m)
  const action = !c.actions ? null
    : m.status === "scheduled" ? `<form method="post" action="/app/outbox/${esc(m.id)}/cancel"><input type="hidden" name="back" value="${esc(c.back)}"><button class="btn quiet sm" type="submit">Cancel</button></form>`
    : unsendable(m) ? `<form method="post" action="/app/outbox/${esc(m.id)}/unsend" data-confirm="Delete this message for everyone in the chat?" class="later"><input type="hidden" name="back" value="${esc(c.back)}"><button class="btn quiet sm" type="submit">Delete</button></form>`
    : ""
  return `<tr class="e" data-id="${esc(m.id)}" data-s="${m.status}">
    <td class="t"><time datetime="${esc(m.at)}" title="${esc(`${full} · ${tz}`)}">${stamp(m.at, tz)}</time></td>
    <td class="s">${entryState(m, tz)}</td>
    <td class="ag">${who}</td>
    ${c.from ? `<td class="fr">${esc(c.from.get(m.connectionId) ?? "")}</td>` : ""}
    <td class="to">${esc(recipient(m.chatId))}</td>
    <td class="b"><span title="${esc(text)}">${m.kind === "first_message" ? `<span class="tag">Opener</span>` : m.kind === "invite" ? `<span class="tag">Invite</span>` : ""}${esc(text)}</span>${err}</td>
    ${action === null ? "" : `<td class="x">${action}</td>`}
  </tr>`
}

/** The table's rows, with a line for each day they cross; the live view swaps exactly this in. */
function activityBody(entries: ActivityEntry[], c: ActivityCtx, emptyText: string): string {
  if (!entries.length) return `<tr class="none"><td colspan="${activityCols(c)}">${emptyText}</td></tr>`
  let last = ""
  return entries.map((m) => {
    const label = dayLabel(m.at, c.tz.get(m.connectionId) ?? "UTC")
    const head = label === last ? "" : `<tr class="dh"><td colspan="${activityCols(c)}">${esc(label)}</td></tr>`
    last = label
    return head + activityRow(m, c)
  }).join("")
}

function activityCtx(connections: Connection[], actions: boolean, back: string): ActivityCtx {
  // With more than one account, each line says which number it went out from.
  const many = connections.filter((x) => x.status !== "logged_out" && x.status !== "error").length > 1
  return {
    tz: new Map(connections.map((x) => [x.id, x.timezone])), actions, back,
    from: many ? new Map(connections.map((x) => [x.id, waNumber(x.handle) || channelName(x.channel)])) : undefined,
  }
}

function activityTable(entries: ActivityEntry[], c: ActivityCtx, opts: { live?: string; emptyText: string }): string {
  return `<div class="atable"${opts.live ? ` data-live="${esc(opts.live)}"` : ""}><table class="atbl">
    <colgroup><col class="c-t"><col class="c-s"><col class="c-ag">${c.from ? `<col class="c-fr">` : ""}<col class="c-to"><col>${c.actions ? `<col class="c-x">` : ""}</colgroup>
    <thead><tr><th>Time</th><th>Status</th><th>Agent</th>${c.from ? "<th>From</th>" : ""}<th>To</th><th>Message</th>${c.actions ? "<th></th>" : ""}</tr></thead>
    <tbody>${activityBody(entries, c, opts.emptyText)}</tbody></table></div>`
}

const liveTag = `<span class="livei" data-live-ind>Can't reach Parley, retrying</span>`
const DASH_EMPTY = "Nothing yet. Every message your agents queue shows up here the moment they ask, then again when it goes out."

/** What the live view fetches: the same rows, rendered the same way, plus the tab counts. */
export function activityFeed(page: ActivityPage, connections: Connection[], f: ActivityFilter & { compact?: boolean }): { body: string; counts: ActivityPage["counts"]; total: number } {
  const c = activityCtx(connections, !f.compact, `/app/activity${activityQuery(f)}`)
  return { body: activityBody(page.entries, c, f.compact ? DASH_EMPTY : activityEmpty(f)), counts: page.counts, total: page.total }
}

const activityEmpty = (f: ActivityFilter) =>
  f.q ? `Nothing matches “${esc(f.q)}”.` : f.status || f.account ? "Nothing here with these filters." : DASH_EMPTY

export function activityPage(opts: {
  user: Viewer; page: ActivityPage; connections: Connection[]; agentCount: number; queuedTotal: number; filter: ActivityFilter; pageNo: number
}): string {
  const f = opts.filter
  const pages = Math.max(1, Math.ceil(opts.page.total / ACTIVITY_PER_PAGE))
  const c = activityCtx(opts.connections, true, `/app/activity${activityQuery({ ...f, page: opts.pageNo })}`)
  const accounts = opts.connections.filter((x) => x.status !== "logged_out" && x.status !== "error")
  const tabs = ACTIVITY_TABS.map(([s, label]) =>
    `<a href="/app/activity${activityQuery({ ...f, status: s })}" class="${f.status === s ? "on" : ""}">${label}<span class="c" data-count="${s ?? "all"}">${opts.page.counts[s ?? "all"].toLocaleString("en-US")}</span></a>`).join("")
  const from = (opts.pageNo - 1) * ACTIVITY_PER_PAGE
  const pageLink = (n: number, label: string, ic: string) => n >= 1 && n <= pages && n !== opts.pageNo
    ? `<a class="btn line sm" href="/app/activity${activityQuery({ ...f, page: n })}">${ic}${label}</a>` : `<span class="btn line sm off" aria-disabled="true">${ic}${label}</span>`
  const pager = opts.page.total > ACTIVITY_PER_PAGE || opts.pageNo > 1
    ? `<div class="pager"><span><b>${opts.page.total ? `${(from + 1).toLocaleString("en-US")}–${Math.min(from + ACTIVITY_PER_PAGE, opts.page.total).toLocaleString("en-US")}` : "0"}</b> of <span data-count="total">${opts.page.total.toLocaleString("en-US")}</span></span>
        <div class="pp"><span class="pn">Page ${opts.pageNo} of ${pages}</span>${pageLink(opts.pageNo - 1, "Newer", icon("back", 12))}${pageLink(opts.pageNo + 1, "Older", "")}</div></div>`
    : ""
  const live = opts.pageNo === 1 ? `/app/activity/feed${activityQuery(f)}` : undefined
  return appShell({
    title: "Activity", active: "activity", user: opts.user, counts: { agents: opts.agentCount, outbox: opts.queuedTotal }, css: OVERVIEW_CSS,
    body: `${pageHead({
      title: "Activity",
      sub: "Every message your agents asked to send, and what became of it. Times are each account's local time.",
      actions: live ? liveTag : `<a class="btn line sm" href="/app/activity${activityQuery(f)}">Back to the latest</a>`,
    })}
    <form class="atools" method="get" action="/app/activity">
      <nav class="seg" aria-label="Status">${tabs}</nav>
      <div class="fl">
        ${f.status ? `<input type="hidden" name="status" value="${esc(f.status)}">` : ""}
        ${accounts.length > 1 ? `<select class="select" name="account" aria-label="Account" onchange="this.form.submit()"><option value="">All accounts</option>${accounts.map((x) => `<option value="${esc(x.id)}"${f.account === x.id ? " selected" : ""}>${esc(waNumber(x.handle) || channelName(x.channel))}</option>`).join("")}</select>` : ""}
        <label class="search">${icon("search", 14)}<input class="input" type="search" name="q" value="${esc(f.q ?? "")}" placeholder="Search messages or numbers" aria-label="Search"></label>
      </div>
    </form>
    ${activityTable(opts.page.entries, c, { live, emptyText: activityEmpty(f) })}
    ${pager}`,
    script: LIVE_SCRIPT,
  })
}

/**
 * Keeps an activity table current: every few seconds while the tab is visible it fetches the same rows and swaps them
 * in, so new sends appear and queued ones turn to sent in place. Lines that are new, or whose state changed, light up.
 * Scrolled into the table, the line at the top of the view stays put while lines arrive above it.
 */
const LIVE_SCRIPT = `(()=>{const box=document.querySelector('[data-live]');if(!box)return;const tb=box.querySelector('tbody'),ind=document.querySelector('[data-live-ind]');let busy=false,last='';
const seen=()=>new Set([...tb.querySelectorAll('tr[data-id]')].map(r=>r.dataset.id+':'+r.dataset.s));
async function tick(){if(busy||document.hidden)return;busy=true;try{const r=await fetch(box.dataset.live,{headers:{accept:'application/json'},credentials:'same-origin'});if(!r.ok)throw 0;const j=await r.json();
if(j.body!==last){const before=seen(),first=!last;last=j.body;const fold=document.querySelector('.top')?.getBoundingClientRect().bottom||0;const anchor=box.getBoundingClientRect().top<fold?[...tb.querySelectorAll('tr[data-id]')].find(r=>r.getBoundingClientRect().bottom>fold):null;const was=anchor&&anchor.getBoundingClientRect().top;tb.innerHTML=j.body;const now=anchor&&tb.querySelector('tr[data-id="'+CSS.escape(anchor.dataset.id)+'"]');if(now)scrollBy(0,now.getBoundingClientRect().top-was);if(!first)tb.querySelectorAll('tr[data-id]').forEach(r=>{if(!before.has(r.dataset.id+':'+r.dataset.s))r.classList.add('fresh')})}
for(const[k,v]of Object.entries(Object.assign({},j.counts,{total:j.total})))document.querySelectorAll('[data-count="'+k+'"]').forEach(e=>e.textContent=Number(v).toLocaleString('en-US'));
ind&&ind.classList.remove('off')}catch(e){ind&&ind.classList.add('off')}busy=false}
tick();setInterval(tick,4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()})})();`

export function dashboardPage(opts: {
  user: Viewer; connections: Connection[]; agents: AgentView[]; mcpUrl: string; syncedCounts?: Map<string, number>
  summaries?: Map<string, ConnectionSummary>; queued?: number; recent?: ActivityEntry[]; webhookCounts?: Map<string, number>
}): string {
  const shown = opts.connections.filter((c) => c.status !== "logged_out" && c.status !== "error")
  const visible = shown.filter((c) => !unfinishedLink(c))
  const resume = shown.find(unfinishedLink)
  const live = visible.filter((c) => c.status === "connected")
  const sentToday = [...(opts.summaries?.values() ?? [])].reduce((n, s) => n + s.sentToday, 0)
  const queued = opts.queued ?? [...(opts.summaries?.values() ?? [])].reduce((n, s) => n + s.queued, 0)
  const activeAgents = opts.agents.filter(isActive).length
  const cards = `<div class="accounts">${visible.map((c) => accountCard(c, opts.summaries?.get(c.id), opts.syncedCounts?.get(c.id), opts.webhookCounts?.get(c.id) ?? 0)).join("")}${addCard(resume)}</div>`
  const attention = live.filter((c) => c.haltedReason)
  const alerts = attention.map((c) => `<div class="note bad" style="margin-bottom:16px"><div class="grow"><b>${esc(waNumber(c.handle) || channelName(c.channel))} stopped sending</b><p>${esc(HALT_TEXT[c.haltedReason!] ?? "Sending is halted until you resume it.")}</p></div><a class="btn line sm" href="/app/connections/${esc(c.id)}">Review</a></div>`).join("")
  const frame = (body: string) => appShell({
    title: "Overview", active: "overview", user: opts.user, counts: { agents: opts.agents.length, outbox: queued }, css: OVERVIEW_CSS, body, script: LIVE_SCRIPT,
  })

  // Setup: until an account is linked and an agent is connected, the page is just the two steps to get there.
  if (!visible.length || !opts.agents.length) {
    const hasChannel = visible.length > 0
    return frame(`${pageHead({ title: "Welcome to Parley", sub: "Two steps and your agents can text people from your own account: connect an account, then connect your agent." })}
    ${alerts}
    ${section("Connect an account", hasChannel ? cards : connectorCards(resume), hasChannel ? doneTag : "", hasChannel ? "" : "Parley links as a companion device, the way WhatsApp Web works. Everything syncs except the chats you ignore.", stepNo(1, hasChannel))}
    ${section("Connect your agent", agentSetup(opts.mcpUrl, opts.agents), opts.agents.length ? doneTag : "Streamable HTTP · OAuth", "", stepNo(2, opts.agents.length > 0))}`)
  }

  return frame(`${pageHead({
      title: "Overview",
      sub: `${live.length} account${live.length === 1 ? "" : "s"} live. Agents queue messages; Parley sends them at the pace of the person who owns each account.`,
    })}
    ${alerts}
    <div class="strip">
      <div><span class="label">Live accounts</span><div class="v">${live.length}</div><div class="h">${visible.length > live.length ? `${visible.length - live.length} waiting to link` : "all online"}</div></div>
      <div><span class="label">Sent today</span><div class="v">${sentToday}</div><div class="h">across every account</div></div>
      <div><span class="label">Queued</span><div class="v">${queued}</div><div class="h">${queued ? "going out at a human pace" : "nothing waiting"}</div></div>
      <div><span class="label">Agents</span><div class="v">${opts.agents.length}</div><div class="h">${activeAgents ? `${activeAgents} active now` : "none active now"}</div></div>
    </div>
    ${section("Accounts", cards, `${live.length} live`)}
    ${section("Activity", activityTable(opts.recent ?? [], activityCtx(opts.connections, false, "/app"), { live: "/app/activity/feed?compact=1", emptyText: DASH_EMPTY }), `${liveTag}<a class="all" href="/app/activity">View all ${icon("arrow", 12)}</a>`)}
    ${foldSection("Connect another agent", agentSetup(opts.mcpUrl, opts.agents), { aside: `${opts.agents.length} connected` })}`)
}

// ---- Outbox -------------------------------------------------------------------------------------------------------

/** A sent message (not a reaction or a deletion) still young enough to delete for everyone. */
function unsendable(m: Outbound): boolean {
  return m.status === "sent" && !m.reactTo && !m.unsend && Boolean(m.sentAt) && Date.parse(m.sentAt!) + UNSEND_WINDOW_MS > Date.now()
}

export function outboxPage(opts: { user: Viewer; scheduled: Outbound[]; connections: Connection[]; agentCount: number }): string {
  const byId = new Map(opts.connections.map((c) => [c.id, c]))
  const rows = opts.scheduled.map((m) => {
    const c = byId.get(m.connectionId)
    const tz = c?.timezone ?? "UTC"
    return `<tr>
      <td><div class="who"><div><b class="mono" style="color:var(--text)">${esc(recipient(m.chatId))}</b><small>${c ? `${channelName(c.channel)} · ${esc(waNumber(c.handle))}` : ""}</small></div></div></td>
      <td class="clip">${esc(outText(m))}</td>
      <td><span class="kind${m.kind === "first_message" ? " open" : ""}">${KIND_LABEL[m.kind] ?? m.kind}</span></td>
      <td class="m">${m.status === "sending" ? status("info", "Sending") : m.scheduledFor ? `<span class="next">${esc(until(m.scheduledFor, tz))}</span>` : `<span class="faint">Held while the channel is paused</span>`}</td>
      <td class="m faint">${m.scheduledFor ? `${clock(m.scheduledFor, tz)} <span class="faint">${esc(cityOf(tz))}</span>` : ""}</td>
      <td class="r"><form method="post" action="/app/outbox/${esc(m.id)}/cancel"><button class="btn quiet sm" type="submit">Cancel</button></form></td>
    </tr>`
  }).join("")
  return appShell({
    title: "Outbox", active: "outbox", user: opts.user, counts: { agents: opts.agentCount, outbox: opts.scheduled.length },
    body: `${pageHead({ title: "Outbox", sub: "What your agents queued and when each one goes out. Parley spaces it out so each account sends like the person who owns it.", actions: `<a class="btn line sm" href="/app/activity">Sent and failed ${icon("arrow", 12)}</a>` })}
      ${rows
        ? `<table class="tbl"><thead><tr><th>To</th><th>Message</th><th>Kind</th><th>Sends</th><th>Local time</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : empty("Nothing scheduled", "Agents queue messages with <code>send_message</code>. Each one shows here with the time it will go out.")}`,
  })
}

// ---- Agents -------------------------------------------------------------------------------------------------------

const TOOL_LABEL: Record<string, string> = {
  read_inbox: "read your inbox", list_chats: "listed your chats", search: "searched your chats", send_message: "queued a message", connect: "started linking a channel",
  connection_status: "checked a connection", list_connections: "listed connections", list_channels: "listed channels",
  send_availability: "checked when it can send", list_outbox: "read the outbox", cancel_message: "canceled a message",
  react_to_message: "queued a reaction", delete_message: "deleted a sent message", get_media: "opened a photo or file", message_status: "checked on a queued message",
}
function activity(a: AgentView): string {
  if (!a.lastUsedAt) return `Authorized ${ago(a.connectedAt)} · hasn't used Parley yet`
  const did = a.lastTool ? ` · last ${esc(TOOL_LABEL[a.lastTool] ?? a.lastTool)}${a.lastToolAt ? ` ${ago(a.lastToolAt)}` : ""}` : ""
  return `${isActive(a) ? "Active now" : `Last active ${ago(a.lastUsedAt)}`}${did} · ${a.calls} tool call${a.calls === 1 ? "" : "s"}`
}

export function agentsPage(opts: { user: Viewer; agents: AgentView[]; mcpUrl: string; queuedTotal?: number }): string {
  const rows = opts.agents.map((a) => `<tr>
      <td><div class="who">${agentMark(a.clientName, 30)}<div><b>${esc(a.clientName || "Unnamed MCP client")}</b></div></div></td>
      <td style="color:var(--muted);font-size:13px">${activity(a)}</td>
      <td class="m faint">${day(a.connectedAt)}</td>
      <td class="r"><form method="post" action="/app/agents/${esc(a.sessionId)}/disconnect" data-confirm="Disconnect this agent? It will need to sign in again."><button class="btn warn sm" type="submit">Disconnect</button></form></td>
    </tr>`).join("")
  return appShell({
    title: "Agents", active: "agents", user: opts.user, counts: { agents: opts.agents.length, outbox: opts.queuedTotal }, css: OVERVIEW_CSS,
    body: `${pageHead({ title: "Agents", sub: "Apps you've authorized to read your synced chats and queue messages for you. Disconnecting one cuts off its tokens immediately." })}
      ${section("Authorized", opts.agents.length
        ? `<table class="tbl"><thead><tr><th>Agent</th><th>Activity</th><th>Since</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : empty("No agents yet", "Connect one below. It opens a browser to sign in with this account."), `${opts.agents.length} authorized`)}
      ${section(opts.agents.length ? "Connect another agent" : "Connect your agent", agentSetup(opts.mcpUrl, []), "Streamable HTTP · OAuth")}`,
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
      <td>${p.enabled ? status("ok", "On") : status("idle", "Off")}</td>
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

// ---- Webhooks -----------------------------------------------------------------------------------------------------

const WEBHOOKS_CSS = `
.whtbl td:first-child{width:100%;min-width:300px}.whtbl td{vertical-align:top}.whtbl td.st-c{white-space:nowrap;padding-top:16px;min-width:240px}.whk{display:flex;flex-direction:column;gap:4px;min-width:0}.whk .nw{white-space:nowrap}.whk .u{font-family:var(--mono);font-size:12.5px;color:var(--text);word-break:break-all}
.whk small{color:var(--faint);font-size:12px}
.evs{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.ev{font-family:var(--mono);font-size:11px;padding:2px 7px;border-radius:6px;background:var(--bg-3);color:var(--text-2);white-space:nowrap}
.acts-row{display:flex;gap:2px;justify-content:flex-end;flex-wrap:nowrap;white-space:nowrap;padding-top:6px}.acts-row form{display:inline}
.evpick{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px 18px}
.evpick label{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;color:var(--text-2);cursor:pointer}
.evpick input{margin-top:3px;accent-color:var(--primary)}.evpick b{font-family:var(--mono);font-weight:400;font-size:12.5px;color:var(--text);display:block}
.evpick span small{color:var(--faint);font-size:12px}
.whsec .addf{display:flex;flex-direction:column;gap:16px;padding-top:18px}
.addwh{margin-top:16px}.addwh > summary{list-style:none;display:inline-flex}.addwh > summary::-webkit-details-marker{display:none}.addwh[open] > summary{opacity:.6}
.whnone{font-size:13.5px;margin:6px 0 0}.chats-h{margin-top:36px;margin-bottom:14px}.whsec .sec-note{margin-bottom:14px}
.edit summary{cursor:pointer;font-family:var(--mono);font-size:11.5px;color:var(--muted)}.edit[open]{padding:14px 0 4px}.edit[open] summary{margin-bottom:14px}
.note.reveal{margin-bottom:20px}.secret{display:flex;flex-direction:column;gap:10px;width:100%}.secret .term{margin:0}
.plrow td{padding-top:4px}.plrow .term{margin:0;max-height:420px;overflow:auto}.plmeta{font-size:12px;margin-bottom:8px}.plmeta .mono{font-family:var(--mono)}
.tbl tbody tr.plrow:hover{background:none}.tbl tr.dlrow{cursor:pointer}.tbl tr.dlrow[aria-expanded="true"]{background:var(--hover)}.tbl tr.dlrow[aria-expanded="true"] td{border-bottom-color:transparent}
.health{font-size:12px;color:var(--faint);display:block;margin-top:6px;white-space:normal;max-width:260px}
`

const shortUrl = (u: string) => {
  try {
    const x = new URL(u)
    return `${x.host}${x.pathname === "/" ? "" : x.pathname}`
  } catch {
    return u
  }
}

const DELIVERY_TONE: Record<Delivery["status"], Tone> = { delivered: "ok", failed: "bad", pending: "warn", sending: "warn" }

function deliveryResult(d: Delivery): string {
  if (d.status === "delivered") return `HTTP ${d.lastStatus}`
  if (d.status === "sending") return "sending now"
  if (d.status === "pending" && !d.attempts) return "waiting to send"
  const why = d.lastError ?? "unknown error"
  if (d.status !== "pending" || !d.nextAttemptAt) return why
  const ms = Date.parse(d.nextAttemptAt) - Date.now()
  return `${why} · retry ${ms <= 1000 ? "now" : ms < 60_000 ? `in ${Math.ceil(ms / 1000)}s` : until(d.nextAttemptAt)}`
}

/** The event checkboxes, for adding a webhook (all on) or editing one (its own). */
const eventPicker = (on: readonly string[]) => `<div class="evpick">${WEBHOOK_EVENTS.map((e) =>
  `<label><input type="checkbox" name="events" value="${e}"${on.includes(e) ? " checked" : ""}><span><b>${e}</b><small>${esc(EVENT_TEXT[e])}</small></span></label>`).join("")}</div>`

/** What the account page's webhooks section shows besides the list: a secret to show, an error, a notice. */
export type WebhooksView = {
  webhooks: Webhook[]; deliveries: Delivery[]
  error?: string | undefined; notice?: string | undefined; revealed?: { id: string; secret: string; fresh: boolean } | undefined
}

/**
 * One number's webhooks, on its account page (`#webhooks`): each endpoint with its events, state and actions, adding
 * one, recent deliveries, and how to receive them. Every form posts under /app/connections/<id>/webhooks.
 */
function webhooksSection(connId: string, name: string, opts: WebhooksView): string {
  const at = `/app/connections/${esc(connId)}/webhooks`
  const hooks = new Map(opts.webhooks.map((w) => [w.id, w]))
  const rows = opts.webhooks.map((w) => {
    const health = w.lastFailureAt && (!w.lastSuccessAt || w.lastFailureAt > w.lastSuccessAt)
      ? `<span class="health">last failed ${ago(w.lastFailureAt)}: ${esc(w.lastError ?? "")}</span>`
      : w.lastSuccessAt ? `<span class="health">last delivered ${ago(w.lastSuccessAt)}</span>` : `<span class="health">nothing sent yet</span>`
    const act = (action: string, label: string, cls = "btn quiet sm", confirm = "") =>
      `<form method="post" action="${at}/${esc(w.id)}/${action}"${confirm ? ` data-confirm="${esc(confirm)}"` : ""}><button class="${cls}" type="submit">${label}</button></form>`
    return `<tr>
      <td><div class="whk"><span class="u">${esc(w.url)}</span>${w.description ? `<small>${esc(w.description)}</small>` : ""}<div class="evs">${w.events.length === WEBHOOK_EVENTS.length ? `<span class="ev">all events</span>` : w.events.map((e) => `<span class="ev">${esc(e)}</span>`).join("")}</div>
        <small>added ${day(w.createdAt)} · ${esc(w.createdBy)} · <span class="nw">secret …${esc(w.secretHint)}</span></small>
        <details class="edit"><summary>edit</summary>
          <form method="post" action="${at}/${esc(w.id)}/update" class="addf" style="padding-top:0">
            <div class="fields"><label class="field"><span>URL</span><input class="input mono" name="url" value="${esc(w.url)}" required></label>
              <label class="field"><span>Description</span><input class="input" name="description" value="${esc(w.description ?? "")}" maxlength="200"></label></div>
            ${eventPicker(w.events)}
            <div><button class="btn line sm" type="submit">Save</button></div>
          </form>
        </details></div></td>
      <td class="st-c">${w.enabled ? status("ok", "On") : status("idle", "Off")}${health}</td>
      <td class="r"><div class="acts-row">
        ${act("test", "Send test")}
        ${act(w.enabled ? "disable" : "enable", w.enabled ? "Turn off" : "Turn on")}
        ${act("secret", "Secret")}
        ${act("rotate", "Rotate", "btn quiet sm", "Make a new signing secret? The current one stops working right away.")}
        ${act("delete", icon("trash", 13), "btn quiet sm", `Delete the webhook to ${shortUrl(w.url)}? Nothing more is sent to it.`)}
      </div></td>
    </tr>`
  }).join("")

  const deliveryRows = opts.deliveries.map((d) => {
    const done = d.status === "delivered" || d.status === "failed"
    const hook = hooks.get(d.webhookId)
    const canResend = done && hook && (hook.enabled || d.event === "webhook.test")
    return `<tr class="dlrow" data-toggle="pl-${esc(d.id)}" aria-expanded="false" title="Show the payload">
      <td class="m faint">${esc(ago(d.createdAt))}</td>
      <td class="m">${esc(d.event)}</td>
      <td class="clip m">${esc(shortUrl(hook?.url ?? ""))}</td>
      <td>${status(DELIVERY_TONE[d.status], d.status)}</td>
      <td class="m">${d.attempts}<span class="faint">/${MAX_ATTEMPTS}</span></td>
      <td class="clip" title="${esc(deliveryResult(d))}">${esc(deliveryResult(d))}</td>
      <td class="r"><div class="acts-row">
        ${canResend ? `<form method="post" action="${at}/deliveries/${esc(d.id)}/resend"><button class="btn quiet sm" type="submit">Resend</button></form>` : ""}
      </div></td>
    </tr>
    <tr class="plrow" id="pl-${esc(d.id)}" hidden><td colspan="7">
      <div class="plmeta faint">Parley-Event-Id <span class="mono">${esc(d.eventId)}</span> · Parley-Delivery-Id <span class="mono">${esc(d.id)}</span></div>
      ${copyLine(JSON.stringify(d.payload, null, 2), { multiline: true })}
    </td></tr>`
  }).join("")

  const revealed = opts.revealed && hooks.get(opts.revealed.id)
  const secretNote = revealed ? `<div class="note reveal"><div class="secret">
      <b>${opts.revealed!.fresh ? "Your signing secret" : "Signing secret"} for ${esc(shortUrl(revealed.url))}</b>
      <p>${opts.revealed!.fresh ? "Copy it into your receiver now. " : ""}Every request carries a <code>Parley-Signature</code> header made with it; check it before trusting a request.</p>
      ${copyLine(opts.revealed!.secret)}
    </div></div>` : ""
  const none = !opts.webhooks.length

  const addForm = opts.webhooks.length < MAX_WEBHOOKS ? `<details class="addwh"${none || opts.error ? " open" : ""}><summary class="btn ${none ? "" : "line "}sm">${icon("plus", 13)}${none ? "Configure a webhook" : "Add webhook"}</summary>
      <form method="post" action="${at}" class="addf">
        <div class="fields">
          <label class="field"><span>URL</span><input class="input mono" name="url" type="url" placeholder="https://example.com/parley/webhook" required></label>
          <label class="field"><span>Description</span><input class="input" name="description" placeholder="CRM sync" maxlength="200"></label>
        </div>
        ${eventPicker(WEBHOOK_EVENTS)}
        <div><button class="btn" type="submit">Add webhook</button></div>
      </form></details>` : ""

  return `<section class="sec whsec" id="webhooks">
      <div class="sec-h"><span class="label">Webhooks</span><span class="aside">${opts.webhooks.length}/${MAX_WEBHOOKS}</span></div>
      <p class="sec-note">Parley calls these URLs the moment a message, reaction or deletion happens on ${esc(name)}, so your app hears about it without polling. Only real, live changes are sent (never history or chats you ignore), and every request is signed.</p>
      ${opts.error ? `<div class="note bad"><div class="grow"><b>Couldn't do that</b><p>${esc(opts.error)}</p></div></div>` : ""}
      ${opts.notice ? `<div class="note"><div class="grow"><p>${esc(opts.notice)}</p></div></div>` : ""}
      ${secretNote}
      ${none ? `<p class="faint whnone">No webhooks on this number yet. Configure one here, or ask your agent to (create_webhook).</p>` : `<table class="tbl whtbl"><thead><tr><th>Endpoint</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
      ${addForm}
    </section>
    ${none ? "" : foldSection("Recent webhook deliveries", opts.deliveries.length
      ? `<table class="tbl"><thead><tr><th>When</th><th>Event</th><th>To</th><th>State</th><th>Tries</th><th>Result</th><th></th></tr></thead><tbody>${deliveryRows}</tbody></table>`
      : empty("Nothing sent yet", "Each event shows up here as it's delivered. Send a test to try an endpoint."), { aside: `${opts.deliveries.length ? `${opts.deliveries.length} latest` : ""}`, open: opts.deliveries.length > 0 && Boolean(opts.notice || opts.revealed) })}`
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
  const others = opts.sessions.length > 1 ? `<form method="post" action="/app/settings/sessions/end-others"><button class="btn quiet sm" type="submit">Sign out other sessions</button></form>` : ""
  return appShell({
    title: "Settings", active: "settings", user: u, counts: { agents: opts.agentCount, outbox: opts.queuedTotal },
    body: `${pageHead({ title: "Settings", sub: "Your Parley account and where you're signed in.", lead: avatar(u, 40) })}
      ${section("Profile", `<div class="kv">
          <div class="k">Name</div><div>${esc(u.name)}</div>
          <div class="k">Email</div><div class="mono">${esc(u.email)}</div>
          <div class="k">Signed in with</div><div>${esc(METHOD[u.signedInWith ?? ""] ?? "—")}</div>
          <div class="k">Member since</div><div>${day(u.createdAt)}</div>
        </div>`, "From your sign-in provider")}
      ${section("Sessions", rows ? `<table class="tbl"><thead><tr><th>Browser</th><th>Method</th><th>Started</th><th>Last seen</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty("No active sessions", ""), others)}
      ${section("Security", `<p class="sec-note">Channel credentials and proxy logins are sealed with AES-256-GCM, bound to the record they belong to. Agents only get the access you authorize; disconnect any of them from <a href="/app/agents" style="color:var(--text);text-decoration:underline;text-underline-offset:3px">Agents</a>.</p>`)}`,
  })
}

// ---- Linking and consent ------------------------------------------------------------------------------------------

const FOCUS_CSS = `
.focus{position:relative;min-height:100vh;display:flex;flex-direction:column}
.focus > header{height:60px;display:flex;align-items:center;padding:0 28px;border-bottom:1px solid var(--line)}
.focus > main{flex:1;display:grid;place-items:center;padding:48px 20px}
.fc{width:100%;max-width:440px;border-radius:20px;background:var(--card);box-shadow:var(--frame),var(--deep);overflow:hidden}
.fc-h{padding:26px 28px 22px;border-bottom:1px solid var(--line)}
.fc-h .label{display:inline-flex;align-items:center;gap:7px}
.fc-h h1{margin:14px 0 0;font-size:26px;line-height:32px;font-weight:400;letter-spacing:-.03em}
.fc-h p{margin-top:8px;font-size:14px;line-height:21px;color:var(--muted)}
.fc-b{padding:24px 28px 28px;display:flex;flex-direction:column;gap:20px}
.fine{font-size:12.5px;color:var(--faint);text-align:center;margin:20px auto 0;max-width:46ch}
.wait{align-self:center;display:flex;flex-direction:column;align-items:center;gap:14px;margin:34px 0;font-size:13px;color:var(--muted)}
`

/** The link page: shows the channel's QR, live-polls, and flips to a success state once connected. */
export function linkPage(id: string): string {
  return shell("Link a channel · Parley", `
    <div class="focus"><header><a href="/app">${LOGO}</a></header><main><div>
      <section class="fc">
        <div class="fc-h"><span class="label" id="step">${channelMark("whatsapp", 14)}WhatsApp · Link a device</span><h1 id="title">Link your account</h1><p id="sub">Preparing a secure link…</p></div>
        <div class="fc-b" id="card"><div class="wait">${orb(40)}Preparing a secure link</div></div>
      </section>
      <p class="fine">Parley links as a companion device, like WhatsApp Web. Unlink it any time from your phone.</p>
      <form method="post" action="/app/connections/${esc(id)}/disconnect" id="cancel" style="text-align:center;margin-top:10px"><button class="btn quiet sm" type="submit">Cancel linking</button></form>
    </div></main></div>
    <script>
      const id=${JSON.stringify(id)};const card=document.getElementById('card'),title=document.getElementById('title'),sub=document.getElementById('sub');
      function render(d){
        if(d.status==='connected'){document.getElementById('cancel')?.remove();title.textContent='Connected';sub.textContent=(d.channel||'Channel').replace(/^./,x=>x.toUpperCase())+' is linked. Your chats sync now; ignore any you want kept from agents.';card.innerHTML='<span class="st ok"><i class="pulse"></i>Live</span><a class="btn lg block" href="'+d.chats_url+'">See your chats</a>';return true}
        if(d.qr_svg){title.textContent='Scan to link';sub.textContent='The code refreshes on its own.';card.innerHTML='<div class="qr">'+d.qr_svg+'</div><ol class="ol"><li>Open WhatsApp on your phone</li><li>Settings → Linked devices</li><li>Link a device, then scan</li></ol>';return false}
        card.innerHTML=${JSON.stringify(`<div class="wait">${orb(40)}Preparing a secure link</div>`)};return false
      }
      async function tick(){try{const r=await fetch('/link/'+id+'/status');if(r.ok){if(render(await r.json()))return}}catch(e){}setTimeout(tick,2000)}
      tick();
    </script>`, {
    css: FOCUS_CSS + `
      .qr{align-self:center;width:260px;height:260px;background:#fff;border-radius:16px;display:grid;place-items:center;padding:14px;box-shadow:0 0 0 1px var(--line-2),0 0 0 7px var(--chip),0 24px 60px -24px rgba(227,185,141,.35)}
      .qr svg{width:100%;height:100%;display:block}
      .ol{margin:0;padding:0;list-style:none;counter-reset:s;display:grid;gap:10px;font-size:13.5px;color:var(--text-2)}
      .ol li{counter-increment:s;display:flex;align-items:center;gap:12px}.ol li::before{content:counter(s);display:inline-grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--line-3);font-size:11.5px;font-weight:500;color:var(--text)}`,
  })
}

const CHATS_CSS = `
.prefs{margin:4px 0 26px;padding:18px 20px;border-radius:16px;background:var(--card);box-shadow:var(--frame)}
.prefs .today{display:flex;gap:18px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-2)}
.prefs .today .m{font-family:var(--mono);font-size:12.5px}
.prefs .today .bar{display:inline-block;width:140px;vertical-align:middle;margin:0}
.prefs .today a{color:var(--sand)}.prefs .today a:hover{text-decoration:underline;text-underline-offset:3px}
.pf{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:16px}
.pf .field{flex:1;min-width:180px}.pf .lim{flex:0 0 140px;min-width:0}.pf .lim > span{white-space:nowrap}.pf .cc{flex:0 0 90px;min-width:0}
.prefs .hint{margin:10px 0 0;font-size:12px;color:var(--faint)}
.sws{display:flex;gap:22px;align-items:center;height:36px;margin-left:12px}
.sw{display:flex;gap:10px;align-items:center;cursor:pointer;font-size:13.5px;color:var(--text-2)}
.sw input{appearance:none;flex:0 0 32px;width:32px;height:18px;margin:0;border-radius:9px;background:var(--bg-3);box-shadow:inset 0 0 0 1px var(--line-2);position:relative;cursor:pointer;transition:background .2s var(--ease)}
.sw input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--knob);box-shadow:var(--knob-shadow);transition:transform .25s var(--ease)}
.sw input:checked{background:var(--primary);box-shadow:var(--primary-shadow)}.sw input:checked::after{transform:translateX(14px);background:var(--on-primary)}
.sw input:focus-visible{box-shadow:var(--ring)}
.lede{font-size:13.5px;line-height:21px;color:var(--muted);margin:0;max-width:80ch}
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:18px 0 4px}
.search{position:relative;flex:1;min-width:240px}.search svg{position:absolute;left:12px;top:11px;color:var(--faint)}
.search .input{padding-left:36px}
.chats{border-top:1px solid var(--line);margin-top:12px}
.chat{display:flex;align-items:center;gap:12px;padding:12px 8px;margin:0 -8px;border-bottom:1px solid var(--line);border-radius:0;transition:background .12s}
.chat:hover{background:var(--hover)}
.chat .grow{flex:1;min-width:0}.chat .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.chat .s{font-size:12.5px;color:var(--faint);margin-top:1px}
.chat .when{font-family:var(--mono);font-size:12px;color:var(--faint);white-space:nowrap}
.chat.off .t,.chat.off .glyph{opacity:.45}
.chat .s.miss{color:var(--bad)}
.ign{font:inherit;font-size:12.5px;font-weight:500;height:28px;padding:0 12px;border-radius:999px;border:0;background:var(--glass);box-shadow:var(--glass-ring);color:var(--text-2);cursor:pointer;white-space:nowrap;transition:background .15s var(--ease),color .15s var(--ease)}
.ign:hover{color:var(--text);background:var(--glass-hi)}
.chat.off .ign{background:color-mix(in srgb,var(--sand) 13%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sand) 35%,transparent);color:var(--sand)}
.ign:disabled{opacity:.5;cursor:default}
.none{display:none!important}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{font:inherit;font-size:12.5px;height:30px;padding:0 13px;border-radius:999px;border:0;background:none;box-shadow:inset 0 0 0 1px var(--line-2);color:var(--muted);cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease)}
.tag:hover{color:var(--text)}
.tag[aria-pressed="true"]{background:var(--glass-hi);box-shadow:var(--glass-ring);color:var(--text)}
.tag .n{font-family:var(--mono);font-size:11px;opacity:.6;margin-left:6px}
.older{display:block;width:100%;padding:16px 0;border:0;background:none;color:var(--text-2);font:inherit;font-size:13px;cursor:pointer;text-align:center}
.older:hover{color:var(--text)}
.stale{margin:10px 0 0;font-size:12.5px;color:var(--faint)}
.stale button{font:inherit;color:var(--text-2);background:none;border:0;padding:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.stale button:hover{color:var(--text)}
.tally{font-size:12.5px;color:var(--muted);margin:16px 0 0}
.sync{margin:12px 0 0;padding:16px 18px;border-radius:14px;background:var(--card);box-shadow:var(--frame)}
.sync .row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.sync .row b{display:inline-flex;align-items:center;gap:10px;font-weight:500}.sync .row span{font-family:var(--mono);font-size:12px;color:var(--text-2)}
.sync p{margin:8px 0 0;font-size:12.5px;color:var(--faint)}
.sync .bar{height:4px;border-radius:99px;background:var(--bg-3);overflow:hidden;margin-top:12px;display:block;width:auto}
.sync .bar i{display:block;height:100%;background:linear-gradient(90deg,#b8794a,#f0cda5);border-radius:99px;transition:width .6s var(--ease)}
.sync .bar.busy i{animation:busy 1.4s var(--ease) infinite alternate}@keyframes busy{from{margin-left:0}to{margin-left:70%}}
.empty .orb{margin-bottom:16px}
`

/** Today's sending, and this number's settings: how many messages a day, the gap between them, read receipts, typing, active hours. */
/** A switch in form `form` that saves it as soon as it's flipped. */
const toggle = (form: string, name: string, on: boolean, label: string) =>
  `<label class="sw"><input type="checkbox" form="${form}" name="${name}" value="on"${on ? " checked" : ""} onchange="this.form.submit()">${label}</label>`

function sendingPrefs(conn: Connection, today: DailyUsage | null, queued: number): string {
  // The switches sit in the daily limit's row but belong to their own form (forms can't nest).
  const behave = `behave-${esc(conn.id)}`
  const hours = `hours-${esc(conn.id)}`
  const dflt = policyFor(conn.channel).gapSeconds
  const used = today ? `<span class="m">${bar(today.sentToday, today.dailyLimit)}&nbsp;&nbsp;${today.sentToday}<span class="faint"> / ${today.dailyLimit} sent today</span></span>` : ""
  return `<div class="prefs">
    <div class="today">${used}${queued ? `<a href="/app/outbox">${queued} queued</a>` : `<span class="faint">nothing queued</span>`}</div>
    <form method="post" action="/app/connections/${esc(conn.id)}/locale" class="pf">
      <label class="field lim"><span>Daily sending limit</span><input class="input" name="daily_limit" type="number" min="1" max="1000" step="1" value="${conn.dailyLimit}" required onchange="this.form.requestSubmit()"></label>
      <label class="field lim" title="At least this many seconds between two sends, up to twice that at random. Empty keeps the default (${dflt.min}–${dflt.max}s)."><span>Gap between sends (s)</span><input class="input" name="gap_seconds" type="number" min="0" max="${MAX_GAP_SECONDS}" step="1" value="${conn.gapSeconds ?? ""}" placeholder="${dflt.min}–${dflt.max}" onchange="this.form.requestSubmit()"></label>
      <noscript><button class="btn line sm" type="submit">Save</button></noscript>
      <span class="sws">
        ${toggle(behave, "read_receipts", conn.readReceipts, "Read receipts")}
        ${toggle(behave, "typing", conn.typing, "Typing")}
        ${toggle(hours, "active_hours", conn.activeHours, "Active hours")}
        <noscript><button class="btn line sm" type="submit" form="${behave}">Save</button></noscript>
      </span>
    </form>
    <form method="post" action="/app/connections/${esc(conn.id)}/behaviour" id="${behave}" hidden></form>
    <form method="post" action="/app/connections/${esc(conn.id)}/locale" id="${hours}" hidden><input type="hidden" name="hours_form" value="1"></form>
  </div>`
}

/**
 * A connected account: its chats, and how it sends. Everything syncs by default; the person taps Ignore on the few
 * agents shouldn't see (people and groups, most recent first, like their phone). Each tap saves at once; filtering is
 * client-side.
 */
export function chatsPage(opts: { user: Viewer; connection: Connection; chats: ChatRow[]; agentCount: number; saved: boolean; today: DailyUsage | null; queued: number; webhooks: WebhooksView }): string {
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
  const loading = `<div class="empty">${orb(28)}<b>Loading your chats</b>Fetching them from ${esc(name)}… this can take a minute after linking.</div>`
  const number = waNumber(conn.handle)
  const st = connectionState(conn)
  const banner = conn.haltedReason
    ? `<div class="note bad"><div class="grow"><b>Sending is stopped</b><p>${esc(HALT_TEXT[conn.haltedReason] ?? `Halted: ${conn.haltedReason}.`)}</p></div>${conn.haltedReason === "banned" ? "" : `<form method="post" action="/app/connections/${esc(conn.id)}/resume"><button class="btn sm" type="submit">Resume sending</button></form>`}</div>`
    : conn.pausedUntil
      ? `<div class="note warn"><div class="grow"><b>Backing off until ${esc(until(conn.pausedUntil, conn.timezone))}</b><p>${esc(name)} asked the account to slow down. Parley waits, then resumes.</p></div><form method="post" action="/app/connections/${esc(conn.id)}/resume"><button class="btn line sm" type="submit">Resume now</button></form></div>`
      : ""
  return appShell({
    title: number || name, active: "overview", user: opts.user, counts: { agents: opts.agentCount }, css: CHATS_CSS + WEBHOOKS_CSS,
    body: `${pageHead({
      title: number || name, crumb: { href: "/app", label: "Overview" }, lead: conn.avatar ? profileMark(conn.channel, conn.avatar, 44) : channelMark(conn.channel, 28),
      sub: `${status(st.tone, st.text)}&nbsp;&nbsp;<span class="faint">${name}${conn.displayName ? ` · ${esc(conn.displayName)}` : ""} · linked ${conn.linkedAt ? ago(conn.linkedAt) : "—"}</span>`,
      actions: `${conn.status === "connected" ? "" : `<a class="btn" href="/link/${esc(conn.id)}">Finish linking</a>`}
        <form method="post" action="/app/connections/${esc(conn.id)}/disconnect" data-confirm="Disconnect ${esc(number ? `${name} ${number}` : name)}? Your agents will lose access to it."><button class="btn warn" type="submit">Disconnect</button></form>`,
    })}
      ${banner}
      ${sendingPrefs(conn, opts.today, opts.queued)}
      ${webhooksSection(conn.id, number || name, opts.webhooks)}
      <div class="sec-h chats-h"><span class="label">Chats</span></div>
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
        <div class="fc-h"><div class="pair">${agentMark(opts.clientName, 40)}<span class="dots"></span>${pmark(40)}</div>
          <h1>Allow ${esc(name)} to use Parley?</h1><p>Signed in as <span class="mono" style="color:var(--text)">${esc(opts.email)}</span></p></div>
        <div class="fc-b">
          <ul class="can">
            ${can("Read", "Messages in your chats, except ones you ignore")}
            ${can("Send", "Queue messages from your connected accounts, at a human pace")}
            ${can("Link", "Start linking a new account (you still scan the QR)")}
          </ul>
          <div class="acts"><button class="btn line lg" type="submit" name="decision" value="deny">Cancel</button><button class="btn lg" type="submit" name="decision" value="allow">Allow</button></div>
        </div>
      </form>
      <p class="fine">${host ? `Returns to <code>${esc(host)}</code>. ` : ""}Disconnect it any time from Agents in your dashboard.</p>
    </div></main></div>`, {
    css: FOCUS_CSS + `
      .pair{display:flex;align-items:center;gap:12px}.pair .glyph{border-radius:12px}
      .dots{position:relative;width:44px;height:2px;border-radius:2px;background:repeating-linear-gradient(90deg,rgba(227,185,141,.5) 0 4px,transparent 4px 8px);background-size:16px 2px;animation:flow 1.2s linear infinite}@keyframes flow{to{background-position:16px 0}}
      .can{list-style:none;margin:0;padding:0;display:grid}.can li{display:grid;grid-template-columns:60px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:13.5px;color:var(--text-2)}
      .can li:first-child{border-top:1px solid var(--line)}.can .label{color:var(--sand);font-weight:500}
      .acts{display:grid;grid-template-columns:1fr 1fr;gap:10px}`,
  })
}
