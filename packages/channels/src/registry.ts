import type { Channel } from "./contract.ts"

/**
 * The registered channels — the single list every layer iterates (MCP `list_channels`/`connect`, the REST API, the
 * link page, the session pool). Adding an integration means adding its module here and nothing else. WhatsApp lands
 * in the next phase; until then this is empty (apps inject a Fake in tests to exercise the plumbing).
 */
export const CHANNELS: Channel[] = []

export function channelById(channels: Channel[], id: string): Channel | undefined {
  return channels.find((c) => c.id === id)
}
