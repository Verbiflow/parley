"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Claude, ParleyMark } from "./logos"

/** Claude asks → Parley holds it for a natural moment → sent → delivered → read, and Maya answers. Then it loops. */
type Stage = 0 | 1 | 2 | 3 | 4
const TIMELINE: Array<[Stage, number]> = [[0, 2600], [1, 3400], [2, 1500], [3, 1500], [4, 5200]]

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

const PMark = ({ size = 22 }: { size?: number }) => (
  <span className="grid place-items-center rounded-[7px] bg-[linear-gradient(180deg,#fffaf3,#e6cfb0)] text-[#1b140e] shadow-[inset_0_1px_0_rgb(255_255_255/0.9)]" style={{ width: size, height: size }}>
    <ParleyMark size={Math.round(size * 0.6)} />
  </span>
)

/* ---------- the phone: an iPhone in dark mode, WhatsApp's iOS chat ---------- */

const SF = "font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Text','Helvetica_Neue',sans-serif]"
const TITANIUM = "bg-[linear-gradient(150deg,#77716a_0%,#3b3834_14%,#1c1b19_38%,#2c2a27_62%,#57524b_88%,#2a2825_100%)]"

const icon = (d: React.ReactNode, size = 18, extra = {}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...extra}>{d}</svg>
)

function StatusBar() {
  return (
    <div className="relative flex h-[40px] shrink-0 items-center text-[13px] font-semibold tracking-[-0.01em] text-white">
      <span className="flex-1 pl-2 text-center">8:12</span>
      <span className="h-[24px] w-[80px] rounded-full bg-black" />
      <span className="flex flex-1 items-center justify-center gap-[5px] pr-1">
        <svg viewBox="0 0 18 12" width="16" height="11" fill="currentColor" aria-hidden><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 16 12" width="14" height="11" fill="currentColor" aria-hidden><path d="M8 2.3c2.3 0 4.4.9 5.9 2.4l1.3-1.3A10.1 10.1 0 0 0 8 .4C5.2.4 2.6 1.5.8 3.4l1.3 1.3A8.3 8.3 0 0 1 8 2.3Zm0 3.5c1.3 0 2.5.5 3.4 1.3l1.3-1.3A6.6 6.6 0 0 0 8 4c-1.8 0-3.5.7-4.7 1.8l1.3 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.4c.5 0 .9.2 1.2.5L8 11 6.8 9.7c.3-.3.7-.5 1.2-.5Z" /></svg>
        <svg viewBox="0 0 27 13" width="24" height="12" aria-hidden><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" strokeOpacity=".4" /><rect x="2" y="2" width="16" height="9" rx="2.2" fill="currentColor" /><path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fill="currentColor" fillOpacity=".45" /></svg>
      </span>
    </div>
  )
}

/** WhatsApp's iOS bubble tail, drawn at the bottom corner of the bubble it belongs to. */
function Tail({ side, color }: { side: "in" | "out"; color: string }) {
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden className={`absolute bottom-0 ${side === "in" ? "-left-[5px]" : "-right-[5px] -scale-x-100"}`}>
      <path d="M8 0v13H2.2C.6 13-.3 11.7.7 11 3.6 9 5 6 5 2.5V0Z" fill={color} />
    </svg>
  )
}

const IN = "#262628"
const OUT = "#144d37"
const WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" fill="none" stroke="#fff" stroke-opacity=".03" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M8 16a6 6 0 0 1 6-6h8a6 6 0 0 1 0 12h-6l-4 3v-3.4A6 6 0 0 1 8 16Z"/>'
  + '<path d="M78 14c2-3 7-2 7 2 0 4-7 8-7 8s-7-4-7-8c0-4 5-5 7-2Z"/>'
  + '<circle cx="112" cy="46" r="5"/>'
  + '<path d="M40 52l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1Z" transform="rotate(-12 40 60)"/>'
  + '<path d="M74 70c3 2 6-2 9 0s6-2 9 0"/>'
  + '<path d="M18 92v8M14 96h8"/>'
  + '<path d="M100 98h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-14a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4Zm4 0v-3h6v3"/>'
  + '<path d="M56 108a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm4.5-1.5h.01M65.5 106.5h.01M60 111c1.6 1.6 4.4 1.6 6 0"/>'
  + '<path d="M118 6l2 4 4 .6-3 2.8.8 4-3.8-2-3.8 2 .8-4-3-2.8 4-.6Z"/>'
  + '</svg>',
)}")`

/** The time and ticks, tucked into the bubble's bottom-right corner the way WhatsApp lays them out. */
function Time({ out, children }: { out?: boolean; children: React.ReactNode }) {
  return <span className={`float-right ml-2 mt-[5px] -mb-[2px] inline-flex items-center gap-0.5 text-[10px] ${out ? "text-[#a3c9b8]" : "text-[#8e8e93]"}`}>{children}</span>
}

function Phone({ stage }: { stage: Stage }) {
  const [replied, setReplied] = useState(false)
  useEffect(() => {
    if (stage !== 4) return setReplied(false)
    const t = setTimeout(() => setReplied(true), 1600)
    return () => clearTimeout(t)
  }, [stage])
  const bubble = "relative max-w-[80%] px-2.5 py-[6px] text-[13.5px] leading-[1.3] text-[#f2f2f2]"
  return (
    <div className="relative w-[272px]">
      {[[96, 20], [136, 40], [186, 40]].map(([top, h]) => <i key={top} className={`absolute -left-[2.5px] w-[3px] rounded-l-[2px] ${TITANIUM}`} style={{ top, height: h }} />)}
      <i className={`absolute -right-[2.5px] top-[150px] h-[64px] w-[3px] rounded-r-[2px] ${TITANIUM}`} />
      <div className={`relative rounded-[50px] p-[3px] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.25),0_0_0_0.5px_rgb(0_0_0/0.8),0_60px_100px_-40px_rgb(0_0_0/0.95),0_20px_40px_-20px_rgb(0_0_0/0.8)] ${TITANIUM}`}>
        <div className="rounded-[47px] bg-black p-[7px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
          <div className={`relative flex h-[540px] flex-col overflow-hidden rounded-[40px] bg-[#0b0b0b] ${SF}`} style={{ backgroundImage: WALLPAPER }}>
            <div className="relative z-10 bg-[rgb(22_22_22/0.86)] shadow-[0_0.5px_0_rgb(255_255_255/0.08)] backdrop-blur-xl">
              <StatusBar />
              <div className="flex h-[46px] items-center gap-2 pl-1.5 pr-3 text-white">
                <span className="flex items-center">{icon(<path d="m15 5-7 7 7 7" />, 22, { strokeWidth: 2.2 })}<span className="-ml-1 text-[13px]">3</span></span>
                <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[linear-gradient(160deg,#c89f78,#7a573c)] text-[11px] font-semibold text-white/90">MO</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[14px] font-semibold tracking-[-0.01em]">Maya Okafor</p>
                  <p className="truncate text-[10.5px] text-[#8e8e93]">{stage === 4 && !replied ? "typing…" : stage >= 3 ? "online" : "last seen today"}</p>
                </div>
                {icon(<><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="m15.5 10.5 5-3v9l-5-3" /></>, 21)}
                <span className="ml-2.5">{icon(<path d="M5 3.5h3.2l1.6 4.2-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2 4.2 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5Z" />, 19)}</span>
              </div>
            </div>

            <div className="flex flex-1 flex-col justify-end gap-[5px] px-3.5 pb-2.5">
              <span className="mb-1.5 self-center rounded-full bg-[#1c1c1e]/90 px-2.5 py-[3px] text-[10.5px] font-medium text-[#98989f]">Today</span>
              <p className={`${bubble} self-start rounded-[15px] rounded-bl-[4px]`} style={{ background: IN }}>
                Can you send the deck before we meet?<Time>7:58</Time>
                <Tail side="in" color={IN} />
              </p>
              <AnimatePresence>
                {stage >= 2 && (
                  <motion.div key="out" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={spring} style={{ originX: 1, originY: 1, background: OUT }} className="relative max-w-[84%] self-end rounded-[15px] rounded-br-[4px] p-[3px] text-[13.5px] leading-[1.3] text-[#f2f2f2]">
                    <div className="flex items-center gap-2.5 rounded-[12px] bg-black/20 p-2">
                      <span className="relative grid h-[34px] w-[27px] shrink-0 place-items-end justify-center rounded-[4px] bg-white pb-1 text-[6.5px] font-bold text-[#e5533c] [clip-path:polygon(0_0,72%_0,100%_22%,100%_100%,0_100%)]">PDF</span>
                      <div className="min-w-0 leading-tight"><p className="truncate text-[12.5px] font-medium">Q4 review.pdf</p><p className="mt-0.5 text-[10px] text-[#a3c9b8]">12 pages · PDF · 2.4 MB</p></div>
                    </div>
                    <p className="px-2 pb-[4px] pt-[5px]">
                      Here&apos;s the deck. Does <b className="font-semibold">Thursday at 3</b> still work?
                      <Time out>8:12 <Ticks n={stage >= 3 ? 2 : 1} read={stage >= 4} /></Time>
                    </p>
                    <Tail side="out" color={OUT} />
                  </motion.div>
                )}
                {replied && (
                  <motion.p key="in" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={spring} style={{ originX: 0, originY: 1, background: IN }} className={`${bubble} self-start rounded-[15px] rounded-bl-[4px]`}>
                    Perfect, see you then 👍<Time>8:14</Time>
                    <Tail side="in" color={IN} />
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="relative bg-[rgb(22_22_22/0.86)] px-2.5 pb-[22px] pt-2 text-white shadow-[0_-0.5px_0_rgb(255_255_255/0.08)] backdrop-blur-xl">
              <div className="flex items-center gap-3">
                {icon(<path d="M12 5v14M5 12h14" />, 22)}
                <span className="flex h-[30px] flex-1 items-center justify-end rounded-full bg-[#2c2c2e] pr-2 text-[#8e8e93]">{icon(<><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M9 14c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M9.5 9.5h.01M14.5 9.5h.01" /></>, 17)}</span>
                {icon(<><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" /><circle cx="12" cy="12.5" r="3.5" /></>, 21)}
                {icon(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>, 21)}
              </div>
              <i className="absolute bottom-[7px] left-1/2 h-[4px] w-[96px] -translate-x-1/2 rounded-full bg-white/90" />
            </div>
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
  const done = stage >= 2
  const calm = done || undefined
  return (
    <div className={`flex items-center gap-3 p-3 ${GLASS} ${className}`}>
      <div aria-hidden className="relative grid size-11 shrink-0 place-items-center">
        <span className="orb-halo absolute -inset-3" data-calm={calm} />
        <motion.span className="orb size-10" data-calm={calm} initial={false} animate={{ scale: done ? [1, 1.12, 1] : 1 }} transition={{ duration: 0.6, ease }}><i /></motion.span>
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
