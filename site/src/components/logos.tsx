import { useId, type SVGProps } from "react"
import { AGENT_MARKS } from "./agent-marks"
import { PATHS, SLACK } from "./paths"

type Props = SVGProps<SVGSVGElement> & { size?: number }

const Glyph = ({ d, size = 16, fill = "currentColor", ...rest }: Props & { d: string; fill?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} aria-hidden {...rest}>
    <path d={d} />
  </svg>
)

export const WhatsApp = (p: Props) => <Glyph d={PATHS.whatsapp} fill="#25D366" {...p} />
export const LinkedIn = (p: Props) => <Glyph d={PATHS.linkedin} fill="#0A66C2" {...p} />
export const Telegram = (p: Props) => <Glyph d={PATHS.telegram} fill="#229ED9" {...p} />
export const Instagram = (p: Props) => <Glyph d={PATHS.instagram} fill="#E4405F" {...p} />
export const Claude = (p: Props) => <Glyph d={PATHS.claude} fill="#D97757" {...p} />
export const OpenAI = (p: Props) => <Glyph d={PATHS.openai} {...p} />
export const Cursor = (p: Props) => <Glyph d={PATHS.cursor} {...p} />

export const Slack = ({ size = 16, ...rest }: Props) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden {...rest}>
    {SLACK.map(([fill, d]) => <path key={fill} fill={fill} d={d} />)}
  </svg>
)

/** Apple publishes no iMessage mark, so this is drawn: a white bubble on Messages green. */
export function IMessage({ size = 16, ...rest }: Props) {
  const id = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden {...rest}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6df26a" />
          <stop offset="1" stopColor="#0dbd2b" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5.6" fill={`url(#${id})`} />
      <path fill="#fff" d="M12 5.3c-4.2 0-7.6 2.8-7.6 6.2 0 2 1.15 3.75 2.95 4.9-.15 1-.75 2.05-1.6 2.75 1.65-.05 3.05-.65 4.05-1.55.7.15 1.45.25 2.2.25 4.2 0 7.6-2.8 7.6-6.35S16.2 5.3 12 5.3z" />
    </svg>
  )
}

export const ParleyMark = ({ size = 18, ...rest }: Props) => (
  <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" fillRule="evenodd" aria-hidden {...rest}>
    <path d={PATHS.parley} />
  </svg>
)

export const GitHub = ({ size = 16, ...rest }: Props) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...rest}>
    <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
  </svg>
)

export const CHANNEL_LOGOS = { whatsapp: WhatsApp, imessage: IMessage, slack: Slack, linkedin: LinkedIn, telegram: Telegram, instagram: Instagram }
export type ChannelId = keyof typeof CHANNEL_LOGOS

const Instinct = ({ size = 16, ...rest }: Props) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
    <circle cx="11.6" cy="3.6" r="2" />
    <path d="M11.4 6.2 11 13.6M11.3 7.6 8.6 11.6M11.4 7.4l2.9 4.4M11 13.6 9.6 21.4M11 13.6l3 7.2" />
  </svg>
)

/** Agent marks for the "works with" row, with the name carried in a title for crawlers and screen readers. */
export function AgentMark({ name, size = 24, className = "" }: { name: string; size?: number; className?: string }) {
  if (name === "Instinct") return <Instinct size={size} className={className} />
  const mark = AGENT_MARKS.find((m) => m.name === name)
  if (!mark) return null
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" fillRule={mark.evenodd ? "evenodd" : undefined} aria-hidden className={className}>
      {mark.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

export const Gmail = ({ size = 16, ...rest }: Props) => (
  <svg viewBox="52 42 88 66" width={size} height={size} aria-hidden {...rest}>
    <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
    <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
    <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
    <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
    <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
  </svg>
)
