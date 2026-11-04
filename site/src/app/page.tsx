import { CopyButton, NavShell } from "@/components/client"
import { Features, Steps } from "@/components/features"
import { Journey } from "@/components/journey"
import { AgentMark, GitHub, Gmail, IMessage, LinkedIn, ParleyMark, Slack, WhatsApp } from "@/components/logos"
import { Threads } from "@/components/threads"
import { APP_URL, Arrow, Button, buttonClass, FRAME, GITHUB_URL, MCP_URL, Shell } from "@/components/ui"

function Nav() {
  return (
    <NavShell>
      <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-10 px-5 sm:px-7">
        <a href="#" className="inline-flex items-center gap-2 text-[15px] font-medium tracking-[-0.02em]">
          <ParleyMark size={18} />
          Parley
        </a>
        <nav className="hidden gap-7 text-[13.5px] text-muted md:flex">
          <a href="#product" className="transition-colors hover:text-ink">Product</a>
          <a href="#start" className="transition-colors hover:text-ink">Get started</a>
          <a href="#faq" className="transition-colors hover:text-ink">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-5">
          <a href={GITHUB_URL} aria-label="Parley on GitHub" title="GitHub" className="text-muted transition-colors hover:text-ink"><GitHub size={17} /></a>
          <a href={APP_URL} className="hidden text-[13.5px] text-muted transition-colors hover:text-ink sm:block">Log in</a>
          <Button href={APP_URL} size="sm">Get started</Button>
        </div>
      </div>
    </NavShell>
  )
}

const H2 = "text-[clamp(26px,2.9vw,36px)] leading-[1.12] font-normal tracking-[-0.03em] text-balance"

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
      <h2 className={H2}>{title}</h2>
      {children && <p className="max-w-[46ch] text-[15.5px] leading-[1.7] text-muted">{children}</p>}
    </div>
  )
}

const AGENTS = ["Claude", "ChatGPT", "Cursor", "Codex", "Grok Bot", "Muse", "Hermes", "OpenClaw", "Instinct"]

const CHANNELS: Array<[string, (p: { size?: number; className?: string }) => React.ReactNode, boolean]> = [
  ["WhatsApp", WhatsApp, true],
  ["iMessage", IMessage, false],
  ["Slack", Slack, false],
  ["LinkedIn", LinkedIn, false],
  ["Gmail", Gmail, false],
]

function Channels({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-5 ${className}`}>
      <span className="text-[12.5px] text-faint">Channels</span>
      <ul className="flex items-center gap-4">
        {CHANNELS.map(([name, Logo, live]) => (
          <li key={name} title={live ? name : `${name}, coming soon`} className="flex">
            <Logo size={20} />
            <span className="sr-only">{live ? `${name} (live)` : `${name} (coming soon)`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Hero() {
  return (
    <div className="relative isolate">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px] overflow-hidden sm:h-[700px] lg:h-[900px]">
        <Threads className="absolute inset-0 size-full" />
      </div>
      <Shell className="grid items-center gap-16 pt-32 sm:gap-20 sm:pt-44 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 lg:pt-36">
        <div>
          <a href={GITHUB_URL} className="group inline-flex h-7 items-center gap-2 rounded-full pl-1 pr-3 text-[12.5px] text-ink-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.08)] transition-colors hover:text-ink">
            <span className="rounded-full bg-sand/15 px-2 py-0.5 text-[11px] font-medium text-sand">New</span>
            Photos, files and reactions
            <Arrow />
          </a>
          <h1 className="mt-6 max-w-[14ch] text-[clamp(38px,5vw,60px)] leading-[1.04] font-normal tracking-[-0.035em] text-balance">
            Let your agents text people as you
          </h1>
          <p className="mt-5 max-w-[430px] text-[16px] leading-[1.6] text-muted">
            Open source messaging infrastructure for AI agents. They send from your own account, at a human pace, with every message on record.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button href={APP_URL}>Get started <Arrow /></Button>
            <a href={GITHUB_URL} className={buttonClass()}><GitHub size={14} />Star on GitHub</a>
          </div>
          <Channels className="mt-12" />
        </div>
        <Journey />
      </Shell>
    </div>
  )
}

function WorksWith() {
  return (
    <Shell className="pt-28 text-center">
      <p className="text-[13.5px] text-faint">Works with the agents you already use, and any MCP client</p>
      <ul className="mx-auto mt-8 flex max-w-[760px] flex-wrap items-center justify-center gap-x-11 gap-y-7 text-muted">
        {AGENTS.map((name) => (
          <li key={name} title={name} className="transition-colors duration-200 hover:text-ink">
            <AgentMark name={name} size={26} />
            <span className="sr-only">{name}</span>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

function Product() {
  return (
    <Shell id="product" className="pt-36">
      <Heading title="Everything your agent needs to message people">
        Your agent writes the message. Parley sends it from your account at a safe pace, and keeps a record of everything it sent.
      </Heading>
      <Features />
    </Shell>
  )
}

function Start() {
  const channels = CHANNELS.map(([name, Logo]) => (
    <span key={name} title={name} className="grid size-9 place-items-center rounded-[10px] bg-[#1d1b18] shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_0_0_1px_rgb(255_255_255/0.07)]">
      <Logo size={17} />
      <span className="sr-only">{name}</span>
    </span>
  ))
  const copy = (
    <div className="flex items-center gap-1.5 rounded-full bg-white/[0.035] p-1 pl-3.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{MCP_URL}</code>
      <CopyButton text={MCP_URL} label="Copy" className={`${buttonClass("primary", "sm")} h-7 shrink-0 px-3 text-[12px]`} />
    </div>
  )
  return (
    <Shell id="start" className="pt-36">
      <Heading title="Set up in a minute" />
      <Steps channels={channels} copy={copy} />
    </Shell>
  )
}

function OpenSource() {
  return (
    <Shell className="pt-36">
      <div className={`grid overflow-hidden rounded-[14px] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] ${FRAME}`}>
        <div className="p-8 sm:p-12">
          <h2 className={H2}>Open source</h2>
          <p className="mt-5 max-w-[44ch] text-[16px] leading-[1.7] text-muted">Your agent speaks for you, so you should be able to read the code that does it. Run Parley on your own servers, or use the hosted version.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            <a href={GITHUB_URL} className={buttonClass("primary")}><GitHub size={14} />View on GitHub</a>
            <Button href={APP_URL} variant="ghost">Use hosted Parley</Button>
          </div>
        </div>
        <div className="flex items-center border-t border-white/[0.06] bg-white/[0.015] p-8 sm:p-12 lg:border-l lg:border-t-0">
          <pre className="w-full overflow-x-auto font-mono text-[12.5px] leading-[1.9] text-muted">
            <span className="text-faint">$</span> <span className="text-ink">git clone</span> github.com/Verbiflow/parley{"\n"}
            <span className="text-faint">$</span> <span className="text-ink">npm install</span>{"\n"}
            <span className="text-faint">$</span> <span className="text-ink">npm run migrate</span>{"\n"}
            <span className="text-faint">$</span> <span className="text-ink">npm run dev</span>
          </pre>
        </div>
      </div>
    </Shell>
  )
}

const FAQ: Array<[string, string]> = [
  ["Will my account get banned?", "Nobody can promise it won't, because messaging apps don't publish their limits for personal accounts. Parley's defaults stay below the levels where people report getting restricted. New accounts start slow, and Parley backs off as soon as an app pushes back."],
  ["Is this an official business API?", "No. Parley links your own account, the same way you'd add a new device. Messages come from you, your phone keeps working, and you can unlink Parley at any time."],
  ["What can my agent see?", "Every chat except the ones you hide. When you hide a chat, Parley deletes what it stored from it and stops storing its messages."],
  ["Which agents can use it?", "Any agent that can connect to a remote MCP server: Claude, ChatGPT, Cursor, Codex, Grok Bot, Muse, Hermes, OpenClaw and others. You add one URL and sign in."],
]

function Faq() {
  return (
    <Shell id="faq" className="pt-36">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <h2 className={H2}>Questions</h2>
        <div>
          {FAQ.map(([q, a], i) => (
            <details key={q} className={`group ${i ? "border-t border-line" : ""}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[15.5px] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="relative size-3 shrink-0 text-muted before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current after:transition-transform group-open:after:scale-y-0" />
              </summary>
              <p className="max-w-[62ch] pb-6 text-[15.5px] leading-[1.7] text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function Closing() {
  return (
    <Shell className="relative isolate pb-36 pt-44 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[520px] bg-[radial-gradient(50%_60%_at_50%_100%,rgb(217_130_91/0.09),transparent)]" />
      <h2 className="mx-auto max-w-[24ch] text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-normal tracking-[-0.035em] text-balance">Your agent&apos;s first message, a few minutes from now</h2>
      <p className="mx-auto mt-4 max-w-[50ch] text-[15.5px] text-balance leading-[1.65] text-muted">Connect your account, paste one URL into your agent, then ask it to reply to someone. That&apos;s the whole setup.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button href={APP_URL}>Get started <Arrow /></Button>
        <a href={GITHUB_URL} className={buttonClass()}><GitHub size={14} />Star on GitHub</a>
      </div>
      <Channels className="mt-12 justify-center" />
    </Shell>
  )
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-9 gap-y-4 px-5 py-9 sm:px-7">
        <a href="#" className="inline-flex items-center gap-2 text-[14px] font-medium text-ink-2"><ParleyMark size={15} />Parley</a>
        <nav className="flex flex-wrap gap-6 text-[13.5px] text-muted">
          <a href="#product" className="hover:text-ink">Product</a>
          <a href="#start" className="hover:text-ink">Get started</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
          <a href={APP_URL} className="hover:text-ink">Log in</a>
        </nav>
        <a href={GITHUB_URL} aria-label="Parley on GitHub" title="GitHub" className="ml-auto text-muted hover:text-ink"><GitHub size={17} /></a>
        <p className="basis-full text-[12.5px] text-faint">Not affiliated with Meta, Apple, Google, Slack or LinkedIn.</p>
      </div>
    </footer>
  )
}

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <WorksWith />
        <Product />
        <Start />
        <OpenSource />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </>
  )
}
