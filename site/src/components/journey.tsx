"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AgentMark, Claude, ParleyMark, WhatsApp } from "./logos"
import { FRAME } from "./ui"

/** Claude asks → Parley holds it for a natural moment → sent → delivered → read, and Maya answers. Then it loops. */
type Stage = 0 | 1 | 2 | 3 | 4
const TIMELINE: Array<[Stage, number]> = [[0, 2600], [1, 3400], [2, 1500], [3, 1500], [4, 5200]]
const HOLD = 108

function useStage(running: boolean): Stage {
  const reduced = useReducedMotion()
  const [stage, setStage] = useState<Stage>(reduced ? 4 : 0)
  useEffect(() => {
    if (reduced) return setStage(4)
    if (!running) return
    const at = TIMELINE.findIndex(([s]) => s === stage)
    const t = setTimeout(() => setStage(TIMELINE[(at + 1) % TIMELINE.length]![0]), TIMELINE[at]![1])
    return () => clearTimeout(t)
  }, [stage, reduced, running])
  return stage
}

function useCountdown(running: boolean) {
  const [left, setLeft] = useState(HOLD)
  useEffect(() => {
    if (!running) return setLeft(HOLD)
    const start = performance.now()
    const id = setInterval(() => setLeft(Math.max(0, Math.round(HOLD * (1 - (performance.now() - start) / 3200)))), 50)
    return () => clearInterval(id)
  }, [running])
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` }
}

const ease = [0.2, 0.8, 0.2, 1] as const
const spring = { type: "spring", stiffness: 420, damping: 34 } as const

const Check = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
)

function Ticks({ n, read, className = "" }: { n: 1 | 2; read: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 11" width="15" height="10" aria-hidden className={`transition-colors duration-500 ${read ? "text-[#53bdeb]" : "text-current"} ${className}`}>
      <path fill="currentColor" d="M11.07.65 4.98 7.34 2.5 4.8 1.4 5.9l3.6 3.6L12.2 1.75z" />
      <path fill="currentColor" className={`transition-opacity duration-300 ${n === 2 ? "opacity-100" : "opacity-0"}`} d="M15.1.65 9.02 7.34 8.1 6.4 7 7.5l2.03 2 7.18-7.75z" />
    </svg>
  )
}

function Avatar({ initials, tone, size = 26 }: { initials: string; tone: string; size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-full text-[10px] font-medium" style={{ width: size, height: size, background: tone, color: "rgb(255 246 232 / .85)" }}>{initials}</span>
}

/* ---------- the Parley outbox window ---------- */

type Status = "holding" | "sent" | "delivered" | "read" | "scheduled"

function StatusChip({ status, countdown }: { status: Status; countdown?: { left: number; label: string } }) {
  const base = "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap"
  if (status === "holding" && countdown) {
    const f = countdown.left / HOLD
    return (
      <span className={`${base} bg-sand/[0.12] text-sand`}>
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden className="-rotate-90">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.2" />
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={37.7} strokeDashoffset={37.7 * (1 - f)} />
        </svg>
        <span className="tabular-nums">Sends in {countdown.label}</span>
      </span>
    )
  }
  if (status === "scheduled") return <span className={`${base} bg-white/[0.05] text-muted`}>Sends at 09:00</span>
  return (
    <span className={`${base} ${status === "read" ? "bg-[#53bdeb]/[0.1] text-[#7fcdf0]" : "bg-white/[0.05] text-ink-2"}`}>
      <Ticks n={status === "sent" ? 1 : 2} read={status === "read"} />
      {status === "sent" ? "Sent" : status === "delivered" ? "Delivered" : "Read"}
    </span>
  )
}

type Row = { id: string; agent: string; to: string; initials: string; tone: string; text: string; status: Status; at: string }

const ROWS: Row[] = [
  { id: "sam", agent: "ChatGPT", to: "Sam Reyes", initials: "SR", tone: "#3b3a52", text: "Running 10 min late, start without me", status: "read", at: "08:04" },
  { id: "team", agent: "Cursor", to: "Product team", initials: "PT", tone: "#2f4038", text: "Release notes are up, link in the doc", status: "delivered", at: "07:58" },
  { id: "priya", agent: "Claude", to: "Priya Shah", initials: "PS", tone: "#4a3530", text: "Happy birthday!! Dinner on me this week", status: "scheduled", at: "" },
  { id: "dan", agent: "Codex", to: "Dan Wu", initials: "DW", tone: "#2e3b4a", text: "PR is merged, deploy goes out at noon", status: "read", at: "07:41" },
]

const NAV: Array<[string, string]> = [
  ["Overview", "M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-4H4z"],
  ["Outbox", "M4 13h4l2 3h4l2-3h4M5.5 5h13L21 13v6H3v-6z"],
  ["Chats", "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"],
  ["Agents", "M12 3v3M8 10h.01M16 10h.01M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"],
  ["Settings", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"],
]

function OutboxWindow({ stage }: { stage: Stage }) {
  const countdown = useCountdown(stage === 1)
  const maya: Row = {
    id: "maya", agent: "Claude", to: "Maya Okafor", initials: "MO", tone: "#4a3f30", text: "Here's the deck. Does Thursday at 3 still work?",
    status: stage <= 1 ? "holding" : stage === 2 ? "sent" : stage === 3 ? "delivered" : "read", at: stage >= 2 ? "08:12" : "",
  }
  const rows = stage >= 1 ? [maya, ...ROWS] : ROWS
  return (
    <div className={`overflow-hidden rounded-[14px] ${FRAME}`}>
      <div className="relative flex h-9 items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.015] px-3.5">
        {[0, 1, 2].map((i) => <i key={i} className="size-[9px] rounded-full bg-white/[0.1]" />)}
        <p className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 py-[3px] text-[11px] text-faint">
          <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" /></svg>
          app.itsparley.com
        </p>
      </div>
      <div className="grid h-[456px] grid-cols-[176px_1fr]">
        <aside className="flex flex-col border-r border-white/[0.06] bg-black/[0.18] p-3">
          <div className="flex items-center gap-2 px-1.5 py-1">
            <span className="grid size-[22px] place-items-center rounded-[6px] bg-ink text-bg"><ParleyMark size={13} /></span>
            <span className="text-[12.5px] font-medium">Alex Rivera</span>
          </div>
          <nav className="mt-4 space-y-0.5">
            {NAV.map(([name, d]) => {
              const on = name === "Outbox"
              return (
                <div key={name} className={`flex items-center gap-2.5 rounded-[7px] px-2 py-[6px] text-[12.5px] ${on ? "bg-white/[0.06] text-ink" : "text-muted"}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
                  {name}
                  {on && stage === 1 && <span className="ml-auto rounded-full bg-sand/15 px-1.5 text-[10px] font-medium tabular-nums text-sand">1</span>}
                </div>
              )
            })}
          </nav>
          <div className="mt-auto rounded-[9px] bg-white/[0.035] p-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
            <div className="flex items-center gap-2 text-[11.5px] font-medium"><WhatsApp size={13} />WhatsApp</div>
            <p className="mt-1 font-mono text-[10.5px] text-muted">+44 7700 900123</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[#79d79f]"><span className="size-1.5 rounded-full bg-[#5fd38d] shadow-[0_0_6px_#5fd38d]" />Connected</p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col">
          <div className="flex items-end justify-between pb-3 pl-5 pr-12 pt-4">
            <div>
              <h4 className="text-[15px] font-medium tracking-[-0.01em]">Outbox</h4>
              <p className="mt-0.5 text-[11.5px] text-faint">Everything your agents send, as it happens</p>
            </div>
            <div className="flex rounded-[8px] bg-white/[0.04] p-0.5 text-[11px]">
              {["All", "Queued", "Sent"].map((t, i) => <span key={t} className={`rounded-[6px] px-2.5 py-1 ${i === 0 ? "bg-white/[0.08] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-muted"}`}>{t}</span>)}
            </div>
          </div>

          <PacingStrip stage={stage} />

          <div className="grid grid-cols-[88px_130px_1fr_150px] gap-3 border-y border-white/[0.05] py-2 pl-5 pr-12 text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
            <span>Agent</span><span>To</span><span>Message</span><span>Status</span>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              {rows.map((r) => (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 52 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.45, ease }}
                  className={`grid grid-cols-[88px_130px_1fr_150px] items-center gap-3 border-b border-white/[0.04] pl-5 pr-12 ${r.id === "maya" ? "bg-[linear-gradient(90deg,rgb(227_185_141/0.07),transparent_70%)]" : ""}`}
                >
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                    <span className={`grid size-5 place-items-center rounded-[5px] bg-white/[0.06] ${r.agent === "Claude" ? "text-[#D97757]" : "text-ink-2"}`}><AgentMark name={r.agent} size={11} /></span>
                    {r.agent}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium"><Avatar initials={r.initials} tone={r.tone} size={22} /><span className="truncate">{r.to}</span></span>
                  <span className="truncate text-[12px] text-muted">{r.text}</span>
                  <span className="flex items-center justify-between gap-2">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={r.status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
                        <StatusChip status={r.status} countdown={countdown} />
                      </motion.span>
                    </AnimatePresence>
                    <span className="font-mono text-[10.5px] text-faint">{r.at}</span>
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#11100e] to-transparent" />
          </div>
        </main>
      </div>
    </div>
  )
}

/** Today's sends on a 7am–10pm track: the past ones as ticks, the held one sliding into place. */
function PacingStrip({ stage }: { stage: Stage }) {
  const past = [9, 14, 17, 22, 26, 31]
  return (
    <div className="mb-3 ml-5 mr-12 rounded-[10px] bg-white/[0.025] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">Today <span className="text-faint">· 7 sent · inside 08:00–21:00</span></span>
        <span className="text-faint">{stage === 1 ? <span className="text-sand">Waiting for a natural gap</span> : "Paced for this account"}</span>
      </div>
      <div className="relative mt-2.5 h-5">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.08]" />
        <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.06]" style={{ left: "6.6%", width: "86.6%" }} />
        {past.map((x) => <i key={x} className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-ink-2/70" style={{ left: `${x}%` }} />)}
        <motion.i
          className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-sand shadow-[0_0_10px_rgb(227_185_141/0.8)]"
          initial={false}
          animate={{ left: stage === 0 ? "31%" : "37%", opacity: stage === 0 ? 0 : 1 }}
          transition={{ duration: stage === 1 ? 3.2 : 0.4, ease: stage === 1 ? "linear" : ease }}
        />
        <span className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-white/25" style={{ left: "37%" }} />
      </div>
    </div>
  )
}

/* ---------- the agent ---------- */

function AgentCard({ stage }: { stage: Stage }) {
  return (
    <div className={`w-[300px] overflow-hidden rounded-[16px] ${FRAME} bg-[#151412] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07),0_0_0_1px_rgb(255_255_255/0.08),0_30px_60px_-20px_rgb(0_0_0/0.9)]`}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <Claude size={14} />
        <span className="text-[12.5px] font-medium">Claude</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-faint"><span className="size-1.5 rounded-full bg-[#5fd38d]" />Parley connected</span>
      </div>
      <div className="space-y-3 p-4">
        <p className="ml-auto w-fit max-w-[92%] rounded-[14px] rounded-br-[4px] bg-white/[0.08] px-3 py-2 text-[12.5px] leading-snug">
          Send Maya the Q4 deck and ask if Thursday at 3 still works
        </p>
        <div className="flex items-center gap-2 rounded-[10px] bg-white/[0.035] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
          <span className={`grid size-4 place-items-center rounded-full transition-colors duration-300 ${stage >= 1 ? "bg-[#5fd38d] text-[#0d1a12]" : "bg-white/10"}`}>
            {stage >= 1 ? <Check size={9} /> : <motion.span className="size-2 rounded-full border border-ink-2 border-t-transparent" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} />}
          </span>
          <code className="font-mono text-[11px] text-ink-2">send_message</code>
          <span className="ml-auto truncate text-[10.5px] text-faint">Maya Okafor · 1 file</span>
        </div>
        <div className="h-[60px]">
        <AnimatePresence mode="wait" initial={false}>
          {stage === 0 ? (
            <motion.div key="typing" exit={{ opacity: 0 }} className="flex gap-1 px-1 py-1.5">
              {[0, 1, 2].map((i) => <motion.i key={i} className="size-1.5 rounded-full bg-muted" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}
            </motion.div>
          ) : (
            <motion.p key={stage >= 4 ? "reply" : "done"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="text-[12.5px] leading-relaxed text-ink-2">
              {stage >= 4 ? <>Maya replied: <span className="text-ink">&ldquo;Perfect, see you then&rdquo;</span></> : "Queued on your WhatsApp. It goes out in a couple of minutes, the way you would send it."}
            </motion.p>
          )}
        </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ---------- the phone ---------- */

function Phone({ stage }: { stage: Stage }) {
  const [replied, setReplied] = useState(false)
  useEffect(() => {
    if (stage !== 4) return setReplied(false)
    const t = setTimeout(() => setReplied(true), 1600)
    return () => clearTimeout(t)
  }, [stage])
  return (
    <div className="relative w-[272px] rounded-[46px] bg-[linear-gradient(160deg,#3a3631,#151412_40%,#0c0b0a)] p-[3px] shadow-[0_60px_100px_-40px_rgb(0_0_0/0.95),0_0_0_1px_rgb(0_0_0/0.6)]">
      <div className="rounded-[43px] bg-[#070707] p-[7px]">
        <div className="relative flex h-[540px] flex-col overflow-hidden rounded-[36px] bg-[#0b141a] font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,sans-serif]">
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[12px] font-semibold text-[#e9edef]">
            <span>08:12</span>
            <span className="absolute left-1/2 top-2.5 h-[22px] w-[78px] -translate-x-1/2 rounded-full bg-black" />
            <span className="inline-flex items-end gap-[2px]">{[4, 6, 8, 10].map((h) => <i key={h} className="w-[3px] rounded-[1px] bg-[#e9edef]" style={{ height: h }} />)}</span>
          </div>
          <div className="flex items-center gap-2.5 border-b border-black/30 bg-[#202c33] px-3 py-2.5">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#e9edef" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
            <Avatar initials="MO" tone="#4a3f30" size={30} />
            <div className="leading-tight">
              <p className="text-[13.5px] font-medium text-[#e9edef]">Maya Okafor</p>
              <p className="text-[11px] text-[#8696a0]">{stage === 4 && !replied ? "typing…" : stage >= 3 ? "online" : "last seen today at 07:58"}</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-1.5 px-2.5 pb-3 [background-image:radial-gradient(rgb(255_255_255/.028)_1px,transparent_1.2px)] [background-size:15px_15px]">
            <span className="mb-1 self-center rounded-md bg-[#182229] px-2.5 py-1 text-[10.5px] text-[#8696a0]">Today</span>
            <p className="max-w-[84%] self-start rounded-[9px] rounded-tl-[3px] bg-[#202c33] px-2.5 py-1.5 text-[13px] leading-snug text-[#e9edef]">
              Can you send the deck before we meet?<span className="ml-2 inline-block translate-y-1 text-[10px] text-[#8696a0]">07:58</span>
            </p>
            <AnimatePresence>
              {stage >= 2 && (
                <motion.div key="out" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={spring} style={{ originX: 1, originY: 1 }} className="max-w-[88%] self-end overflow-hidden rounded-[9px] rounded-tr-[3px] bg-[#005c4b] text-[13px] leading-snug text-[#e9edef]">
                  <div className="m-1 flex items-center gap-2.5 rounded-[6px] bg-[#025144] p-2">
                    <span className="grid h-9 w-7 place-items-center rounded-[3px] bg-[#e5533c] text-[7.5px] font-bold text-white">PDF</span>
                    <div className="leading-tight"><p className="text-[12.5px]">Q4 review.pdf</p><p className="text-[10.5px] text-[#8fbcb0]">12 pages · 2.4 MB</p></div>
                  </div>
                  <p className="px-2.5 pb-1.5 pt-0.5">
                    Here&apos;s the deck. Does <b className="font-semibold">Thursday at 3</b> still work?
                    <span className="ml-1.5 inline-flex translate-y-[3px] items-center gap-0.5 text-[10px] text-[#8fbcb0]">08:12 <Ticks n={stage >= 3 ? 2 : 1} read={stage >= 4} /></span>
                  </p>
                </motion.div>
              )}
              {replied && (
                <motion.p key="in" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={spring} style={{ originX: 0, originY: 1 }} className="max-w-[84%] self-start rounded-[9px] rounded-tl-[3px] bg-[#202c33] px-2.5 py-1.5 text-[13px] leading-snug text-[#e9edef]">
                  Perfect, see you then 👍<span className="ml-2 inline-block translate-y-1 text-[10px] text-[#8696a0]">08:14</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2 bg-[#0b141a] px-2.5 pb-5 pt-1.5">
            <span className="h-9 flex-1 rounded-full bg-[#202c33] px-4 text-[12.5px] leading-9 text-[#8696a0]">Message</span>
            <span className="grid size-9 place-items-center rounded-full bg-[#00a884]"><svg viewBox="0 0 24 24" width="16" height="16" fill="#0b141a" aria-hidden><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9Z" /></svg></span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- composition ---------- */

/**
 * Holds a layered scene at its design size and scales it to the available width. The box reserves its height with
 * aspect-ratio before any script runs, and the scene fades in once measured, so nothing moves under the reader.
 */
function Fitted({ w, h, className = "", children }: { w: number; h: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e.contentRect.width && setScale(Math.min(e.contentRect.width / w, 1)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [w])
  return (
    <div ref={ref} className={`relative mx-auto w-full ${className}`} style={{ maxWidth: w, aspectRatio: `${w} / ${h}` }}>
      <div className="absolute left-0 top-0 origin-top-left transition-opacity duration-500" style={{ width: w, height: h, transform: `scale(${scale ?? 1})`, opacity: scale === null ? 0 : 1 }}>
        {children}
      </div>
    </div>
  )
}

const float = (dy: number, duration: number) => ({ animate: { y: [0, dy, 0] }, transition: { repeat: Infinity, duration, ease: "easeInOut" as const } })

export function Journey() {
  const outer = useRef<HTMLDivElement>(null)
  const inView = useInView(outer, { margin: "100px" })
  const stage = useStage(inView)
  return (
    <div ref={outer} className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-7">
      <div aria-hidden className="pointer-events-none absolute -inset-x-10 -bottom-24 top-24 -z-10 bg-[radial-gradient(60%_50%_at_55%_55%,rgb(227_185_141/0.08),transparent_70%)]" />
      <Fitted w={1144} h={600} className="hidden md:block">
        <div className="absolute left-[112px] top-0 w-[780px]"><OutboxWindow stage={stage} /></div>
        <motion.div className="absolute bottom-[8px] left-0" {...float(-6, 7)}><AgentCard stage={stage} /></motion.div>
        <motion.div className="absolute right-[8px] top-[36px]" {...float(6, 8)}><Phone stage={stage} /></motion.div>
      </Fitted>
      <Fitted w={350} h={772} className="md:hidden">
        <div className="absolute right-0 top-[216px]"><Phone stage={stage} /></div>
        <motion.div className="absolute left-0 top-0 z-10" {...float(-4, 7)}><AgentCard stage={stage} /></motion.div>
      </Fitted>
    </div>
  )
}
