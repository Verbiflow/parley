"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { AgentMark, WhatsApp } from "./logos"
import { PATHS } from "./paths"
import { FRAME } from "./ui"

const ease = [0.2, 0.8, 0.2, 1] as const
const PARLEY = PATHS.parley
const spring = { type: "spring", stiffness: 380, damping: 32 } as const

/** A counter that advances every `ms` while the tile is on screen; frozen at `still` for reduced motion. */
function useTick(ms: number, still: number) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: "-10% 0px" })
  const reduced = useReducedMotion()
  const [n, setN] = useState(reduced ? still : 0)
  useEffect(() => {
    if (reduced || !inView) return
    const id = setInterval(() => setN((v) => v + 1), ms)
    return () => clearInterval(id)
  }, [inView, reduced, ms])
  return [ref, n, inView && !reduced] as const
}

function Tile({ title, children, visual, className = "" }: { title: string; children: React.ReactNode; visual: React.ReactNode; className?: string }) {
  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-[18px] ${FRAME} ${className}`}>
      <div className="relative h-[320px] overflow-hidden">
        <div aria-hidden className="absolute inset-0 [background-image:radial-gradient(rgb(255_246_232/0.06)_1px,transparent_1.2px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_70%_at_50%_45%,black,transparent)]" />
        {visual}
      </div>
      <div className="relative px-6 pb-6 pt-1">
        <h3 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h3>
        <p className="mt-1.5 max-w-[46ch] text-[14px] leading-[1.6] text-muted">{children}</p>
      </div>
    </article>
  )
}

/** On phones: a swipeable row that snaps card by card, with dots. From lg up: whatever grid `grid` describes. */
function Carousel({ grid, count, list, children }: { grid: string; count: number; list?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const onScroll = () => {
    const el = ref.current
    const first = el?.firstElementChild as HTMLElement | null
    if (!el || !first) return
    setAt(Math.round(el.scrollLeft / (first.offsetWidth + 12)))
  }
  return (
    <>
      <div ref={ref} onScroll={onScroll} role={list ? "list" : undefined} className={`relative -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 [scrollbar-width:none] sm:-mx-7 sm:scroll-px-7 sm:px-7 lg:mx-0 lg:grid lg:gap-4 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden ${grid}`}>
        {children}
      </div>
      <div className="mt-5 flex justify-center gap-1.5 lg:hidden" aria-hidden>
        {Array.from({ length: count }, (_, i) => <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === at ? "w-5 bg-ink-2" : "w-1.5 bg-white/15"}`} />)}
      </div>
    </>
  )
}

const SLIDE = "w-[86%] shrink-0 snap-start sm:w-[62%] lg:w-auto"

/* ---------- Sends as you: notifications from your name stack up on a lock screen ---------- */

const NOTES = [
  { to: "Maya", text: "Here's the deck. Does Thursday at 3 still work?" },
  { to: "Sam", text: "Running 10 min late, order me the usual" },
  { to: "Priya", text: "Happy birthday!! Dinner on me this week" },
  { to: "Dan", text: "Booked the table for 8, see you there" },
  { to: "Lena", text: "Sent the contract over, sign when you can" },
]

function Identity() {
  const [ref, n] = useTick(2600, 2)
  const shown = [0, 1, 2].map((k) => ({ ...NOTES[(n - k + NOTES.length * 10) % NOTES.length]!, key: n - k })).filter((x) => x.key >= 0)
  return (
    <div ref={ref} className="absolute inset-0 flex items-start justify-center pt-12">
      <div className="absolute left-1/2 top-[-140px] h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(217_130_91/0.22),rgb(227_185_141/0.06)_60%,transparent)] blur-2xl" />
      <div className="relative w-[300px] sm:w-[340px]">
        <p className="text-center font-[-apple-system,BlinkMacSystemFont,sans-serif] text-[44px] font-semibold leading-none tracking-[-0.02em] text-ink/90 tabular-nums">08:12</p>
        <p className="mt-1 text-center text-[11.5px] text-muted">Maya&apos;s phone</p>
        <div className="relative mt-5 h-[150px]">
          <AnimatePresence initial={false}>
            {shown.map((note, i) => (
              <motion.div
                key={note.key}
                layout
                initial={{ opacity: 0, y: -24, scale: 1.02 }}
                animate={{ opacity: i === 0 ? 1 : i === 1 ? 0.75 : 0.45, y: i * 22, scale: 1 - i * 0.06, zIndex: 10 - i }}
                exit={{ opacity: 0, y: 40, scale: 0.85 }}
                transition={spring}
                className="absolute inset-x-0 top-0 origin-top rounded-[18px] bg-[rgb(52_48_43/0.72)] p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_12px_30px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl"
              >
                <div className="flex items-start gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#25D366]"><WhatsApp size={19} className="[&_path]:fill-white" /></span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[12.5px] font-semibold text-ink">Alex Rivera</p>
                      <span className="text-[10.5px] text-muted">now</span>
                    </div>
                    <p className="truncate text-[12.5px] text-ink-2">{note.text}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ---------- Paced like a person: a day swept by a playhead ---------- */

const HOURS = [8.2, 8.9, 9.6, 10.8, 11.3, 12.9, 13.6, 14.8, 15.9, 16.4, 17.7, 18.8, 19.6, 20.4]

function Pacing() {
  const [ref, n, running] = useTick(5200, 1)
  const day = (h: number) => `${((h - 6) / 17) * 100}%`
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col justify-center gap-7 px-8">
      {[["A script", true], ["Parley", false]].map(([label, bot]) => (
        <div key={String(label)}>
          <div className="mb-2.5 flex items-center justify-between text-[11.5px]">
            <span className="text-ink-2">{label}</span>
            <AnimatePresence mode="wait">
              <motion.span key={`${label}-${n}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: bot ? 1.1 : 4.4, duration: 0.3 }} className={bot ? "rounded-full bg-[#e5533c]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#f08a73]" : "rounded-full bg-[#5fd38d]/12 px-2 py-0.5 text-[10.5px] font-medium text-[#79d79f]"}>
                {bot ? "Flagged as spam" : "14 sent · looks like you"}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="relative h-11 overflow-hidden rounded-[10px] bg-white/[0.03] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
            {!bot && <div className="absolute inset-y-0 bg-white/[0.025]" style={{ left: day(8), right: `calc(100% - ${day(21)})` }} />}
            {(bot ? Array.from({ length: 14 }, (_, i) => 9.4 + i * 0.035) : HOURS).map((h, i) => (
              <motion.i
                key={`${n}-${i}`}
                className={`absolute top-1/2 w-[3px] -translate-y-1/2 rounded-full ${bot ? "h-6 bg-[#f08a73]" : "h-4 bg-ink-2"}`}
                style={{ left: day(h) }}
                initial={running ? { opacity: 0, scaleY: 0.2 } : false}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ delay: ((h - 6) / 17) * 4.6, duration: 0.35, ease }}
              />
            ))}
            {running && (
              <motion.span key={`ph-${n}`} className="absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-sand to-transparent shadow-[0_0_12px_rgb(227_185_141/0.9)]" initial={{ left: "0%" }} animate={{ left: "100%" }} transition={{ duration: 4.6, ease: "linear" }} />
            )}
          </div>
        </div>
      ))}
      <div className="-mt-3 flex justify-between font-mono text-[10px] text-faint"><span>06:00</span><span>active 08:00–21:00</span><span>23:00</span></div>
    </div>
  )
}

/* ---------- Rich messages: a chat that fills in with every kind of message ---------- */

function Rich() {
  const [ref, n] = useTick(1500, 5)
  const step = n % 7
  const shown = (k: number) => step >= k
  const bubble = "max-w-[84%] rounded-[10px] text-[12.5px] leading-snug text-[#e9edef] shadow-[0_1px_0_rgb(0_0_0/0.25)]"
  return (
    <div ref={ref} className="absolute inset-0 flex justify-center pt-7">
      <div className="flex h-[290px] w-[292px] flex-col sm:w-[330px] justify-end gap-1.5 overflow-hidden rounded-[16px] bg-[#0b141a] p-3 font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,sans-serif] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),0_24px_50px_-24px_rgb(0_0_0/0.9)]">
        <AnimatePresence initial={false}>
          <motion.p layout key="q" className={`${bubble} self-start rounded-tl-[3px] bg-[#202c33] px-2.5 py-1.5`}>Which slides changed?</motion.p>
          {shown(1) && (
            <motion.div layout key="fmt" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className={`${bubble} self-end rounded-tr-[3px] bg-[#005c4b] px-2.5 py-1.5`}>
              <b className="font-semibold">Three changes</b> since Monday:
              <ul className="mt-0.5 list-disc pl-4 text-[#d7e9e3]"><li>Revenue on slide 4</li><li>Pricing <i>still in draft</i></li></ul>
            </motion.div>
          )}
          {shown(2) && (
            <motion.div layout key="photo" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className={`${bubble} relative self-end rounded-tr-[3px] bg-[#005c4b] p-1`}>
              <div className="relative h-[86px] w-[200px] overflow-hidden rounded-[7px] bg-[linear-gradient(180deg,#f3b37a_0%,#d9825b_45%,#6d3b2c_100%)]">
                <i className="absolute left-[58%] top-[30%] size-7 rounded-full bg-[#fde2b8] shadow-[0_0_30px_10px_rgb(253_226_184/0.5)]" />
                <i className="absolute -bottom-6 -left-4 h-14 w-40 rounded-[50%] bg-[#3f2620]" />
                <i className="absolute -bottom-8 left-16 h-14 w-48 rounded-[50%] bg-[#2b1a16]" />
              </div>
              <p className="px-1.5 pb-0.5 pt-1">From the offsite</p>
              <AnimatePresence>
                {shown(3) && (
                  <motion.span key="r" initial={{ scale: 0, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 600, damping: 18 }} className="absolute -bottom-3 left-2 rounded-full bg-[#202c33] px-1.5 py-[1px] text-[12px] shadow-[0_0_0_2px_#0b141a]">❤️</motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
          {shown(4) && (
            <motion.div layout key="voice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className={`${bubble} mt-2 flex items-center gap-2 self-end rounded-tr-[3px] bg-[#005c4b] px-2.5 py-2`}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#e9edef" aria-hidden><path d="M8 5v14l11-7z" /></svg>
              <span className="flex h-5 items-center gap-[2px]">
                {[5, 9, 14, 8, 12, 18, 10, 6, 13, 16, 9, 5, 11, 7, 4].map((h, i) => <motion.i key={i} className="w-[2px] rounded-full bg-[#9fd3c4]" style={{ height: h }} animate={{ scaleY: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.06 }} />)}
              </span>
              <span className="text-[10.5px] text-[#9fd3c4]">0:12</span>
            </motion.div>
          )}
          {shown(5) && (
            <motion.div layout key="pdf" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className={`${bubble} flex items-center gap-2.5 self-end rounded-tr-[3px] bg-[#005c4b] p-1.5 pr-3`}>
              <span className="grid h-8 w-6 place-items-center rounded-[3px] bg-[#e5533c] text-[7px] font-bold text-white">PDF</span>
              <span className="leading-tight"><span className="block text-[12px]">Q4 review.pdf</span><span className="text-[10px] text-[#9fd3c4]">12 pages</span></span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ---------- Everything on record: a live feed, and a switch for each agent ---------- */

const FEED = [
  { agent: "Claude", to: "Maya Okafor" },
  { agent: "Cursor", to: "Product team" },
  { agent: "ChatGPT", to: "Sam Reyes" },
  { agent: "Claude", to: "Priya Shah" },
  { agent: "Codex", to: "Dan Wu" },
  { agent: "Grok Bot", to: "Lena Fischer" },
]
const STEPS = ["Queued", "Sent", "Delivered", "Read"] as const

function Record() {
  const [ref, n] = useTick(1300, 8)
  const rows = [0, 1, 2, 3, 4].map((k) => n - k).filter((i) => i >= 0)
  const paused = Math.floor(n / 6) % 2 === 1
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col px-5 pt-6 sm:px-7 sm:pt-7">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-2 text-ink-2"><span className="relative grid size-2 place-items-center"><span className="absolute size-2 animate-ping rounded-full bg-[#5fd38d]/60" /><span className="size-1.5 rounded-full bg-[#5fd38d]" /></span>Live</span>
        <button type="button" tabIndex={-1} aria-hidden className="flex items-center gap-2 text-muted">
          Cursor
          <span className={`relative h-[18px] w-8 rounded-full transition-colors duration-300 ${paused ? "bg-white/10" : "bg-[#5fd38d]/80"}`}>
            <motion.span className="absolute top-[2px] size-[14px] rounded-full bg-ink shadow" animate={{ left: paused ? 2 : 16 }} transition={spring} />
          </span>
        </button>
      </div>
      <div className="relative mt-4 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {rows.map((i, pos) => {
            const item = FEED[i % FEED.length]!
            const halted = paused && item.agent === "Cursor" && pos === 0
            const step = halted ? -1 : Math.min(pos, 3)
            return (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1 - pos * 0.16, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="mb-1.5 flex items-center gap-3 rounded-[11px] bg-white/[0.035] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.045)]"
              >
                <span className={`grid size-6 place-items-center rounded-[7px] bg-white/[0.06] ${item.agent === "Claude" ? "text-[#D97757]" : "text-ink-2"}`}><AgentMark name={item.agent} size={13} /></span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]"><span className="text-ink">{item.to}</span><span className="text-faint"> · {item.agent}</span></span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${step === -1 ? "bg-[#e5533c]/15 text-[#f08a73]" : step === 3 ? "bg-[#53bdeb]/12 text-[#7fcdf0]" : step === 0 ? "bg-sand/12 text-sand" : "bg-white/[0.06] text-ink-2"}`}>
                    {step === -1 ? "Canceled" : STEPS[step]}
                  </motion.span>
                </AnimatePresence>
                <span className="w-9 text-right font-mono text-[10px] text-faint">08:{String(12 - pos * 3).padStart(2, "0")}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#11100e] to-transparent" />
      </div>
    </div>
  )
}

export function Features() {
  return (
    <div className="mt-12 lg:mt-14">
    <Carousel grid="lg:grid-cols-12" count={4}>
      <Tile className={`${SLIDE} lg:col-span-7`} title="Sends as you" visual={<Identity />}>
        Messages come from your own number, in the chats people already have with you. No bot account, no &ldquo;sent by AI&rdquo; label.
      </Tile>
      <Tile className={`${SLIDE} lg:col-span-5`} title="Paced like a person" visual={<Pacing />}>
        Accounts get flagged for sending like software. Parley spaces messages out, keeps to your waking hours and starts slow on new accounts.
      </Tile>
      <Tile className={`${SLIDE} lg:col-span-5`} title="Rich messages" visual={<Rich />}>
        Formatting, photos, voice notes, files and reactions, shown the way each app shows them.
      </Tile>
      <Tile className={`${SLIDE} lg:col-span-7`} title="Everything on record" visual={<Record />}>
        See which agent sent what, when it went out and whether it was read. Cancel anything still queued, or pause an agent in one click.
      </Tile>
    </Carousel>
    </div>
  )
}

/* ---------- Set up: three steps, each with its own small scene ---------- */

/** A QR-shaped grid: the three finder squares, and cells from a fixed seed so it renders the same on server and client. */
function Qr() {
  const n = 21
  const finder = (x: number, y: number) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => x >= fx! && x < fx! + 7 && y >= fy! && y < fy! + 7)
  const cells: Array<[number, number]> = []
  let seed = 7
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    seed = (seed * 9301 + 49297) % 233280
    if (!finder(x, y) && seed / 233280 > 0.52) cells.push([x, y])
  }
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className="size-full" aria-hidden>
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} rx={0.22} fill="currentColor" />)}
      {[[0, 0], [n - 7, 0], [0, n - 7]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x! + 0.5} y={y! + 0.5} width={6} height={6} rx={1.6} fill="none" stroke="currentColor" strokeWidth={1} />
          <rect x={x! + 2} y={y! + 2} width={3} height={3} rx={0.8} fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

function LinkScene({ channels }: { channels: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-7">
      <div className="relative size-[112px] overflow-hidden rounded-[14px] bg-[#f3efe8] p-2 text-[#1b1712] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.1)]">
        <Qr />
        <span className="scan absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent to-[rgb(217_130_91/0.45)] [border-bottom:1.5px_solid_rgb(217_130_91)]" />
      </div>
      <div className="flex w-[124px] flex-wrap justify-center gap-2">{channels}</div>
    </div>
  )
}

function Wire() {
  const agents = ["Claude", "ChatGPT", "Cursor"]
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 240 120" className="absolute h-[120px] w-[240px]" aria-hidden>
        {[22, 60, 98].map((y, i) => (
          <g key={y}>
            <path d={`M44 ${y} C 110 ${y}, 120 60, 186 60`} fill="none" stroke="rgb(255 246 232 / .12)" strokeWidth="1" />
            <path d={`M44 ${y} C 110 ${y}, 120 60, 186 60`} fill="none" stroke="rgb(227 185 141)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="14 160" className="flow" style={{ animationDelay: `${i * 0.6}s` }} />
          </g>
        ))}
      </svg>
      <div className="relative flex h-[120px] w-[240px] items-center justify-between">
        <div className="flex flex-col gap-[10px]">
          {agents.map((a) => (
            <span key={a} title={a} className={`grid size-7 place-items-center rounded-[8px] bg-[#1d1b18] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_rgb(255_255_255/0.08)] ${a === "Claude" ? "text-[#D97757]" : "text-ink-2"}`}><AgentMark name={a} size={14} /></span>
          ))}
        </div>
        <span className="grid size-[52px] place-items-center rounded-[14px] bg-[linear-gradient(180deg,#fffaf3,#e6cfb0)] text-[#1b140e] shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_0_0_1px_rgb(227_185_141/0.5),0_0_40px_-4px_rgb(227_185_141/0.5)]">
          <svg viewBox="0 0 64 64" width="24" height="24" fill="currentColor" fillRule="evenodd" aria-hidden><path d={PARLEY} /></svg>
        </span>
      </div>
    </div>
  )
}

const PROMPT = "Reply to everyone who's waiting on me"

function Ask() {
  const [ref, n] = useTick(90, PROMPT.length + 20)
  const cycle = PROMPT.length + 26
  const t = n % cycle
  const typed = PROMPT.slice(0, Math.min(t, PROMPT.length))
  const sent = t >= PROMPT.length + 6
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center px-6">
      <div className="w-full max-w-[300px] rounded-[16px] bg-[#1a1916] p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_0_0_1px_rgb(255_255_255/0.08),0_20px_40px_-20px_rgb(0_0_0/0.9)]">
        <p className="h-[42px] text-[13px] leading-[1.6] text-ink">
          {typed}
          {!sent && <span className="ml-px inline-block h-[15px] w-[1.5px] translate-y-[3px] animate-blink bg-sand" />}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-1 text-[10.5px] text-muted"><span className="grid size-3.5 place-items-center rounded-[4px] bg-ink text-bg"><svg viewBox="0 0 64 64" width="8" height="8" fill="currentColor" fillRule="evenodd" aria-hidden><path d={PARLEY} /></svg></span>Parley</span>
          <motion.span animate={{ scale: sent ? [1, 0.88, 1] : 1 }} transition={{ duration: 0.3 }} className={`ml-auto grid size-7 place-items-center rounded-full transition-colors duration-300 ${typed.length === PROMPT.length ? "bg-ink text-bg" : "bg-white/[0.08] text-faint"}`}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </motion.span>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, visual, children }: { n: number; title: string; visual: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="listitem" className={`${SLIDE} relative flex flex-col overflow-hidden rounded-[18px] ${FRAME}`}>
      <div className="relative h-[200px] overflow-hidden">
        <div aria-hidden className="absolute inset-0 [background-image:radial-gradient(rgb(255_246_232/0.06)_1px,transparent_1.2px)] [background-size:18px_18px] [mask-image:radial-gradient(65%_65%_at_50%_50%,black,transparent)]" />
        {visual}
      </div>
      <div className="flex flex-1 flex-col px-6 pb-6 pt-1">
        <h3 className="text-[15px] font-medium tracking-[-0.01em]"><span className="sr-only">Step {n}: </span>{title}</h3>
        <div className="mt-1.5 flex flex-1 flex-col text-[14px] leading-[1.6] text-muted">{children}</div>
      </div>
    </div>
  )
}

export function Steps({ channels, copy }: { channels: React.ReactNode; copy: React.ReactNode }) {
  return (
    <div className="mt-10 lg:mt-12">
    <Carousel grid="lg:grid-cols-3" count={3} list>
      <Step n={1} title="Connect your accounts" visual={<LinkScene channels={channels} />}>
        <p>Sign in and link the accounts your agents can use. Each one takes a QR scan or a sign-in, the same as adding a new device.</p>
      </Step>
      <Step n={2} title="Add Parley to your agent" visual={<Wire />}>
        <p>Paste one URL into Claude, ChatGPT, Cursor or any MCP client, then sign in. No API keys.</p>
        <div className="mt-auto pt-5">{copy}</div>
      </Step>
      <Step n={3} title="Ask" visual={<Ask />}>
        <p>Your agent finds the chats that are waiting, writes the replies, and Parley sends them as you.</p>
      </Step>
    </Carousel>
    </div>
  )
}
