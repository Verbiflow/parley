"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AgentMark, Claude, ParleyMark, WhatsApp } from "./logos"

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

/* ---------- the panels ---------- */

const PANEL = "rounded-[18px] bg-[#161513] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07),0_0_0_1px_rgb(255_255_255/0.075),0_40px_80px_-32px_rgb(0_0_0/0.95)]"

function PanelHead({ icon, title, aside }: { icon: React.ReactNode; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
      {icon}
      <span className="text-[12.5px] font-medium">{title}</span>
      {aside && <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">{aside}</span>}
    </div>
  )
}

const PMark = ({ size = 22 }: { size?: number }) => (
  <span className="grid place-items-center rounded-[7px] bg-[linear-gradient(180deg,#fffaf3,#e6cfb0)] text-[#1b140e] shadow-[inset_0_1px_0_rgb(255_255_255/0.9)]" style={{ width: size, height: size }}>
    <ParleyMark size={Math.round(size * 0.6)} />
  </span>
)

const RULES: Array<[string, string]> = [
  ["Inside your hours", "M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
  ["1m 48s after your last send", "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  ["4 of 40 new chats today", "M4 19h16M7 16V10M12 16V6M17 16v-4"],
]

/** Parley holding the message: who it sends as, the countdown to a natural moment, and the rules it is keeping. */
function ParleyPanel({ stage }: { stage: Stage }) {
  const { left, label } = useCountdown(stage === 1)
  const f = stage === 0 ? 1 : stage === 1 ? left / HOLD : 0
  const holding = stage === 1
  return (
    <div className={`relative w-[360px] overflow-hidden ${PANEL}`}>
      <motion.div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(227_185_141/0.22),transparent)]" animate={{ opacity: holding ? 1 : 0.35 }} transition={{ duration: 0.6 }} />
      <PanelHead icon={<PMark size={20} />} title="Parley" aside={<><WhatsApp size={12} />+44 7700 900123</>} />
      <div className="relative flex items-center gap-4 px-4 pb-4 pt-5">
        <div className="relative grid size-[76px] shrink-0 place-items-center">
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgb(255 246 232 / .08)" strokeWidth="5" />
            <circle cx="40" cy="40" r="34" fill="none" stroke={stage >= 2 ? "#5fd38d" : "rgb(227 185 141)"} strokeWidth="5" strokeLinecap="round" strokeDasharray={213.6} strokeDashoffset={213.6 * (1 - (stage >= 2 ? 1 : f))} style={{ transition: "stroke .4s, stroke-dashoffset .1s linear" }} />
          </svg>
          <AnimatePresence mode="wait" initial={false}>
            {stage >= 2 ? (
              <motion.span key="ok" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="text-[#5fd38d]"><Check size={22} /></motion.span>
            ) : (
              <motion.span key="clock" exit={{ scale: 0.5, opacity: 0 }} className="font-mono text-[17px] tabular-nums tracking-[-0.02em] text-ink">{stage === 0 ? "–" : label}</motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={stage === 0 ? "a" : stage === 1 ? "b" : "c"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="text-[14px] font-medium tracking-[-0.01em]">
              {stage === 0 ? "Waiting for your agent" : stage === 1 ? "Holding for a natural gap" : "Sent at 08:12"}
            </motion.p>
          </AnimatePresence>
          <p className="mt-1 flex items-center gap-2 text-[12px] text-muted"><Avatar initials="AR" tone="#4a3a2c" size={18} />Sending as Alex Rivera</p>
        </div>
      </div>
      <ul className="space-y-px border-t border-white/[0.06] px-2 py-2">
        {RULES.map(([text, d], i) => {
          const ok = stage >= 2 || (stage === 1 && left < HOLD - (i + 1) * 22)
          return (
            <li key={text} className="flex items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-[12px]">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden><path d={d} /></svg>
              <span className="text-ink-2">{text}</span>
              <span className={`ml-auto grid size-4 place-items-center rounded-full transition-all duration-300 ${ok ? "bg-[#5fd38d]/15 text-[#79d79f]" : "bg-white/[0.05] text-transparent"}`}><Check size={8} /></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const AGENTS: Array<[string, string]> = [["Claude", "Sending to Maya"], ["Cursor", "Idle"], ["ChatGPT", "Idle"]]

function AgentsPanel({ stage }: { stage: Stage }) {
  return (
    <div className={`w-[300px] overflow-hidden ${PANEL}`}>
      <PanelHead icon={<span className="text-muted"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v3M8 11h.01M16 11h.01M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /></svg></span>} title="Your agents" aside="3 connected" />
      <ul className="p-2">
        {AGENTS.map(([name, idle]) => {
          const busy = name === "Claude" && stage <= 1
          return (
            <li key={name} className="flex items-center gap-2.5 rounded-[10px] px-2 py-2">
              <span className={`grid size-7 place-items-center rounded-[8px] bg-white/[0.05] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)] ${name === "Claude" ? "text-[#D97757]" : "text-ink-2"}`}><AgentMark name={name} size={14} /></span>
              <div className="min-w-0 leading-tight">
                <p className="text-[12.5px] font-medium">{name}</p>
                <p className={`text-[11px] transition-colors ${busy ? "text-sand" : "text-faint"}`}>{name === "Claude" ? (stage <= 1 ? idle : "Sent 1 message") : idle}</p>
              </div>
              <span className="relative ml-auto h-[18px] w-8 rounded-full bg-[#5fd38d]/75"><span className="absolute right-[2px] top-[2px] size-[14px] rounded-full bg-ink shadow" /></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const TRAIL: Array<[string, string, Stage]> = [["Queued by Claude", "08:10", 1], ["Sent from your number", "08:12", 2], ["Delivered", "08:12", 3], ["Read by Maya", "08:13", 4]]

function RecordPanel({ stage }: { stage: Stage }) {
  return (
    <div className={`w-[360px] overflow-hidden ${PANEL}`}>
      <PanelHead icon={<span className="text-muted"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" /></svg></span>} title="Record" aside={<><Avatar initials="MO" tone="#4a3f30" size={16} />Maya Okafor</>} />
      <ol className="relative px-4 py-3">
        <span className="absolute left-[23px] top-[27px] h-[90px] w-px bg-white/[0.08]" />
        <motion.span className="absolute left-[23px] top-[27px] w-px bg-sand" initial={false} animate={{ height: Math.max(0, stage - 1) * 30 }} transition={{ duration: 0.5, ease }} />
        {TRAIL.map(([text, at, from]) => {
          const on = stage >= from
          return (
            <li key={text} className="relative flex h-[30px] items-center gap-3">
              <span className={`relative z-10 grid size-[15px] place-items-center rounded-full transition-all duration-300 ${on ? (from === 4 ? "bg-[#53bdeb] text-[#0b141a]" : "bg-sand text-[#1b140e]") : "bg-[#161513] shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.15)] text-transparent"}`}><Check size={8} /></span>
              <span className={`text-[12.5px] transition-colors duration-300 ${on ? "text-ink" : "text-faint"}`}>{text}</span>
              <span className={`ml-auto font-mono text-[10.5px] transition-opacity duration-300 ${on ? "text-muted opacity-100" : "opacity-0"}`}>{at}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Thin wires between the panels; a light runs along one when the message crosses it. */
function Wires({ stage, paths }: { stage: Stage; paths: Array<{ d: string; on: Stage[] }> }) {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      {paths.map(({ d, on }, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="rgb(255 246 232 / .1)" strokeWidth="1" />
          {on.includes(stage) && (
            <motion.path key={`${i}-${stage}`} d={d} fill="none" stroke="rgb(240 205 165)" strokeWidth="1.6" strokeLinecap="round" initial={{ pathLength: 0.18, pathOffset: 0, opacity: 0 }} animate={{ pathOffset: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 1.1, ease: "easeInOut" }} style={{ filter: "drop-shadow(0 0 4px rgb(227 185 141 / .9))" }} />
          )}
        </g>
      ))}
    </svg>
  )
}

/* ---------- the agent ---------- */

function AgentCard({ stage }: { stage: Stage }) {
  return (
    <div className={`w-[300px] overflow-hidden ${PANEL}`}>
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
        <div className="h-[40px]">
        <AnimatePresence mode="wait" initial={false}>
          {stage === 0 ? (
            <motion.div key="typing" exit={{ opacity: 0 }} className="flex gap-1 px-1 py-1.5">
              {[0, 1, 2].map((i) => <motion.i key={i} className="size-1.5 rounded-full bg-muted" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}
            </motion.div>
          ) : (
            <motion.p key={stage >= 4 ? "reply" : "done"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="text-[12.5px] leading-relaxed text-ink-2">
              {stage >= 4 ? <>Maya replied: <span className="text-ink">&ldquo;Perfect, see you then&rdquo;</span></> : "Queued. It goes out from your WhatsApp in about two minutes."}
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
      <Fitted w={1144} h={580} className="hidden md:block">
        <Wires
          stage={stage}
          paths={[
            { d: "M330 118 C 362 118, 362 120, 400 120", on: [0] },
            { d: "M330 420 C 368 420, 362 150, 400 150", on: [] },
            { d: "M760 120 C 800 120, 790 300, 830 300", on: [2] },
            { d: "M580 286 L 580 336", on: [3, 4] },
          ]}
        />
        <div className="absolute left-[30px] top-[24px]"><AgentCard stage={stage} /></div>
        <div className="absolute left-[30px] top-[322px]"><AgentsPanel stage={stage} /></div>
        <div className="absolute left-[400px] top-0"><ParleyPanel stage={stage} /></div>
        <div className="absolute left-[400px] top-[336px]"><RecordPanel stage={stage} /></div>
        <div className="absolute left-[830px] top-[6px]"><Phone stage={stage} /></div>
      </Fitted>
      <Fitted w={350} h={772} className="md:hidden">
        <div className="absolute right-0 top-[216px]"><Phone stage={stage} /></div>
        <motion.div className="absolute left-0 top-0 z-10" {...float(-4, 7)}><AgentCard stage={stage} /></motion.div>
      </Fitted>
    </div>
  )
}
