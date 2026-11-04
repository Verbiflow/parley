"use client"

import { useEffect, useState } from "react"

/** The top bar picks up a backdrop once the page scrolls under it. */
export function NavShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  return (
    <header className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200 ${scrolled ? "border-line bg-bg/75 backdrop-blur-xl backdrop-saturate-150" : "border-transparent"}`}>
      {children}
    </header>
  )
}

export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {}
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {copied ? <path d="M20 6 9 17l-5-5" /> : <><rect width="13" height="13" x="9" y="9" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
      </svg>
      <span>{copied ? "Copied" : label}</span>
    </button>
  )
}
