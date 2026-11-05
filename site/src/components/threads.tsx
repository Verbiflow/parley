"use client"

import { useEffect, useRef } from "react"

type Pt = [number, number]

/** Where the threads pinch together, as a fraction of the box. */
export const PINCH = { desktop: [0.64, 0.48] as Pt, mobile: [0.5, 0.7] as Pt }
/** Matches the hero's `lg` breakpoint, where the phone moves beside the copy. */
const WIDE = 1024

const LINES = 44
const PULSES = 7

function bezier(a: Pt, b: Pt, c: Pt, d: Pt, u: number): Pt {
  const v = 1 - u
  return [
    v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
    v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1],
  ]
}

/** Many message threads drawn in from the left, pinched through one point, fanned back out to the right. */
export function Threads({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const pulses = Array.from({ length: PULSES }, (_, k) => ({ line: (k * 23) % LINES, u: k / PULSES, speed: 0.06 + (k % 3) * 0.018 }))

    const curve = (i: number, t: number): [Pt, Pt, Pt, Pt] => {
      const mobile = w < WIDE
      const [px, py] = mobile ? PINCH.mobile : PINCH.desktop
      const f = i / (LINES - 1)
      const sway = Math.sin(t * 0.35 + f * 5.5) * 0.018
      const P: Pt = [px * w, py * h]
      const a: Pt = mobile ? [-0.1 * w, h * (0.2 + 1.1 * f)] : [-0.04 * w, h * (0.7 + 1.1 * f + sway)]
      const d: Pt = mobile ? [1.1 * w, h * (0.25 + 1.1 * f)] : [1.04 * w, h * (-0.75 + 1.05 * f - sway)]
      const spread = (f - 0.5) * h
      const b: Pt = [P[0] - w * 0.16, P[1] + spread * (0.1 + sway)]
      const c: Pt = [P[0] + w * 0.08, P[1] + spread * (0.05 - sway)]
      return [a, b, c, d]
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const light = window.matchMedia("(prefers-color-scheme: light)")
    // On paper the threads are drawn in caramel and laid over the page; on the dark page they add light.
    const palette = () => light.matches
      ? { line: "150,96,52", peak: "128,76,38", pulse: "163,101,58", k: 0.8, blend: "source-over" as const }
      : { line: "227,185,141", peak: "240,205,165", pulse: "248,214,172", k: 1, blend: "lighter" as const }
    let P = palette()
    const rgba = (c: string, a: number) => `rgba(${c},${a * P.k})`
    const t0 = performance.now()
    let frame = 0
    let last = t0
    let visible = true

    const draw = (now: number) => {
      const t = (now - t0) / 1000 + 12
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      ctx.clearRect(0, 0, w, h)
      const [px] = w < WIDE ? PINCH.mobile : PINCH.desktop

      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, rgba(P.line, 0))
      grad.addColorStop(Math.max(px - 0.24, 0.05), rgba(P.line, 0.05))
      grad.addColorStop(px, rgba(P.peak, 0.5))
      grad.addColorStop(Math.min(px + 0.16, 0.98), rgba(P.line, 0.16))
      grad.addColorStop(1, rgba(P.line, 0.04))
      ctx.strokeStyle = grad
      ctx.lineWidth = 0.75
      ctx.beginPath()
      for (let i = 0; i < LINES; i++) {
        const [a, b, c, d] = curve(i, t)
        ctx.moveTo(a[0], a[1])
        ctx.bezierCurveTo(b[0], b[1], c[0], c[1], d[0], d[1])
      }
      ctx.stroke()

      ctx.globalCompositeOperation = P.blend
      for (const p of pulses) {
        if (!still) p.u += p.speed * dt
        if (p.u > 1.05) {
          p.u = -0.05
          p.line = (p.line + 17) % LINES
        }
        const [a, b, c, d] = curve(p.line, t)
        const head = Math.min(Math.max(p.u, 0), 1)
        const tail = Math.max(head - 0.07, 0)
        const [hx] = bezier(a, b, c, d, head)
        const reveal = Math.min(Math.max((hx / w - (px - 0.3)) / 0.2, 0), 1)
        const fade = Math.sin(Math.PI * Math.min(Math.max(p.u, 0), 1)) * reveal
        for (const [width, alpha] of [[3, 0.12], [1.2, 0.85]] as const) {
          ctx.beginPath()
          for (let s = 0; s <= 10; s++) {
            const [x, y] = bezier(a, b, c, d, tail + ((head - tail) * s) / 10)
            if (s) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
          }
          ctx.strokeStyle = rgba(P.pulse, alpha * fade)
          ctx.lineWidth = width
          ctx.stroke()
        }
      }
      ctx.globalCompositeOperation = "source-over"

      if (!canvas.dataset.ready) canvas.dataset.ready = "1"
      if (!still && visible && !document.hidden) frame = requestAnimationFrame(draw)
    }

    const resume = () => {
      cancelAnimationFrame(frame)
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) resume()
    })
    io.observe(canvas)
    const ro = new ResizeObserver(() => {
      resize()
      resume()
    })
    ro.observe(canvas)
    const onVis = () => !document.hidden && visible && resume()
    document.addEventListener("visibilitychange", onVis)
    const onScheme = () => {
      P = palette()
      resume()
    }
    light.addEventListener("change", onScheme)
    resume()

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      light.removeEventListener("change", onScheme)
    }
  }, [])

  return <canvas ref={ref} aria-hidden className={`opacity-0 transition-opacity duration-1000 data-ready:opacity-100 ${className}`} />
}
