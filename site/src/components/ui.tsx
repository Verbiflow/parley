import Link from "next/link"

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.itsparley.com"
export const MCP_URL = `${APP_URL}/mcp`
export const GITHUB_URL = "https://github.com/Verbiflow/parley"

const BUTTON = {
  primary: "sheen text-[color:var(--on-primary)] bg-[image:var(--primary)] shadow-[var(--primary-shadow)] hover:brightness-[1.04]",
  ghost: "text-ink-2 bg-[image:var(--glass)] shadow-[var(--glass-ring)] hover:text-ink hover:bg-[image:var(--glass-hi)]",
}

const SIZE = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-9 px-4 text-[13.5px]",
}

/** The raised surface every card and window on the page shares: hairline edge, a lit top edge, a deep soft shadow. */
export const FRAME = "bg-[var(--card)] shadow-[var(--frame)]"

export const buttonClass = (variant: keyof typeof BUTTON = "ghost", size: keyof typeof SIZE = "md") =>
  `group inline-flex items-center justify-center gap-1.5 rounded-full font-medium tracking-[-0.005em] whitespace-nowrap transition-[filter,color,transform] duration-150 active:scale-[.98] cursor-pointer ${SIZE[size]} ${BUTTON[variant]}`

export function Button({ href, children, variant = "primary", size = "md" }: { href: string; children: React.ReactNode; variant?: keyof typeof BUTTON; size?: keyof typeof SIZE }) {
  return <Link href={href} className={buttonClass(variant, size)}>{children}</Link>
}

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="-mr-0.5 transition-transform duration-150 group-hover:translate-x-0.5">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  )
}

export function Shell({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-[1200px] px-5 sm:px-7 ${className}`}>
      {children}
    </section>
  )
}
