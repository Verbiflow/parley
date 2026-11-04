"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Claude, ParleyMark } from "./logos"

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

const PMark = ({ size = 22 }: { size?: number }) => (
  <span className="grid place-items-center rounded-[7px] bg-[linear-gradient(180deg,#fffaf3,#e6cfb0)] text-[#1b140e] shadow-[inset_0_1px_0_rgb(255_255_255/0.9)]" style={{ width: size, height: size }}>
    <ParleyMark size={Math.round(size * 0.6)} />
  </span>
)

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

/* ---------- the scene: the phone, with the ask and the hold floating over it ---------- */

const GLASS = "rounded-[16px] bg-[rgb(30_28_25/0.92)] shadow-[inset_0_1px_0_rgb(255_255_255/0.09),0_0_0_1px_rgb(255_255_255/0.09),0_24px_48px_-16px_rgb(0_0_0/0.95)]"

/** Parley holding the message for a natural moment, then confirming it went out from your number. */
function ParleyPill({ stage, className = "" }: { stage: Stage; className?: string }) {
  const { left, label } = useCountdown(stage === 1)
  const done = stage >= 2
  return (
    <div className={`flex items-center gap-3 p-3 ${GLASS} ${className}`}>
      <div className="relative grid size-11 shrink-0 place-items-center">
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="20" cy="20" r="17" fill="none" stroke="rgb(255 246 232 / .1)" strokeWidth="3" />
          <circle cx="20" cy="20" r="17" fill="none" stroke={done ? "#5fd38d" : "rgb(227 185 141)"} strokeWidth="3" strokeLinecap="round" strokeDasharray={106.8} strokeDashoffset={106.8 * (done ? 0 : stage === 0 ? 1 : 1 - left / HOLD)} style={{ transition: "stroke .4s" }} />
        </svg>
        {done ? <span className="text-[#5fd38d]"><Check size={13} /></span> : <span className="font-mono text-[10.5px] tabular-nums text-ink">{stage === 0 ? "–" : label}</span>}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="flex items-center gap-1.5 text-[11px] text-muted"><PMark size={14} />Parley</p>
        <p className="mt-1 text-[12.5px] font-medium">{done ? "Sent from your number" : stage === 1 ? "Holding for a natural gap" : "Waiting for your agent"}</p>
      </div>
    </div>
  )
}

function Scene({ stage }: { stage: Stage }) {
  return (
    <>
      <div className="absolute left-1/2 top-0 -translate-x-1/2"><Phone stage={stage} /></div>
      <motion.div className={`absolute left-0 top-[118px] w-[238px] p-3 ${GLASS}`} initial={false} animate={{ opacity: stage >= 2 ? 0 : 1, y: stage >= 2 ? -8 : 0 }} transition={{ duration: 0.4, ease }}>
        <div className="flex items-center gap-2 text-[11.5px]"><Claude size={13} /><span className="font-medium">Claude</span>
          <span className={`ml-auto grid size-4 place-items-center rounded-full transition-colors ${stage >= 1 ? "bg-[#5fd38d] text-[#0d1a12]" : "bg-white/10 text-transparent"}`}><Check size={8} /></span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink">Send Maya the Q4 deck and ask if Thursday at 3 still works</p>
      </motion.div>
      <motion.div className="absolute right-0 top-[212px] w-[226px]" initial={false} animate={{ opacity: stage === 0 || stage >= 3 ? 0 : 1, y: stage === 0 ? 10 : 0, scale: stage === 0 ? 0.96 : 1 }} transition={{ duration: 0.4, ease }}>
        <ParleyPill stage={stage} />
      </motion.div>
    </>
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

export function Journey({ className = "" }: { className?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inView = useInView(outer, { margin: "100px" })
  const stage = useStage(inView)
  return (
    <div ref={outer} className={`relative w-full ${className}`}>
      <div aria-hidden className="pointer-events-none absolute -inset-20 -z-10 bg-[radial-gradient(45%_45%_at_50%_50%,rgb(227_185_141/0.09),transparent_70%)]" />
      <Fitted w={350} h={576}>
        <Scene stage={stage} />
      </Fitted>
    </div>
  )
}
