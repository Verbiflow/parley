/**
 * What a send costs the account, which is what limits are counted against.
 * - `message`: into a conversation the account already has
 * - `first_message`: opening a conversation with someone who never talked to this account; the highest ban risk on
 *   every platform
 * - `invite`: a LinkedIn connection request, with or without a note
 */
export const ACTIONS = ["message", "first_message", "invite"] as const
export type ActionKind = (typeof ACTIONS)[number]

export type Range = { min: number; max: number }

export type ActionLimit = {
  daily: number
  /** Rolling seven days. */
  weekly?: number
  /** Minutes between two actions of this kind, so a day's quota spreads across the day. */
  spacingMinutes?: Range
  /** A fresh account starts at `start` a day and grows by `growth` per day it uses its allowance. */
  warmup: { start: number; growth: number }
}

export type PacingPolicy = {
  /** Local hours, `[start, end)`. */
  activeHours: { start: number; end: number }
  /** 0 is Sunday. */
  activeDays: number[]
  /** Seconds between any two actions on the account. */
  gapSeconds: Range
  /** Minutes of activity before a break. */
  burstMinutes: Range
  /** Must exceed `gapSeconds.max`, or ordinary gaps would count as breaks. */
  breakMinutes: Range
  /** An action missing here is not supported on the channel. */
  actions: Partial<Record<ActionKind, ActionLimit>>
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]

/**
 * Starting defaults, deliberately below where operators report getting restricted. None of these platforms
 * publishes limits for personal accounts; tune per connection rather than raising these.
 */
export const POLICIES: Record<string, PacingPolicy> = {
  whatsapp: {
    activeHours: { start: 8, end: 21 }, activeDays: EVERY_DAY,
    gapSeconds: { min: 30, max: 150 }, burstMinutes: { min: 20, max: 45 }, breakMinutes: { min: 10, max: 30 },
    actions: {
      message: { daily: 300, warmup: { start: 40, growth: 1.25 } },
      first_message: { daily: 25, spacingMinutes: { min: 10, max: 30 }, warmup: { start: 3, growth: 1.2 } },
    },
  },
  linkedin: {
    activeHours: { start: 8, end: 19 }, activeDays: WEEKDAYS,
    gapSeconds: { min: 90, max: 300 }, burstMinutes: { min: 30, max: 60 }, breakMinutes: { min: 10, max: 40 },
    actions: {
      invite: { daily: 20, weekly: 100, spacingMinutes: { min: 12, max: 35 }, warmup: { start: 5, growth: 1.2 } },
      message: { daily: 60, warmup: { start: 15, growth: 1.25 } },
      first_message: { daily: 10, spacingMinutes: { min: 20, max: 60 }, warmup: { start: 2, growth: 1.2 } },
    },
  },
  instagram: {
    activeHours: { start: 9, end: 22 }, activeDays: EVERY_DAY,
    gapSeconds: { min: 60, max: 240 }, burstMinutes: { min: 20, max: 45 }, breakMinutes: { min: 10, max: 35 },
    actions: {
      message: { daily: 100, warmup: { start: 20, growth: 1.25 } },
      first_message: { daily: 25, spacingMinutes: { min: 10, max: 30 }, warmup: { start: 3, growth: 1.2 } },
    },
  },
  telegram: {
    activeHours: { start: 8, end: 22 }, activeDays: EVERY_DAY,
    gapSeconds: { min: 20, max: 120 }, burstMinutes: { min: 20, max: 45 }, breakMinutes: { min: 10, max: 30 },
    actions: {
      message: { daily: 300, warmup: { start: 40, growth: 1.25 } },
      first_message: { daily: 20, spacingMinutes: { min: 10, max: 30 }, warmup: { start: 3, growth: 1.2 } },
    },
  },
}

/** A channel without its own policy (a new integration, a test fake) gets WhatsApp's: conservative and every day. */
export const policyFor = (channel: string): PacingPolicy => POLICIES[channel] ?? POLICIES.whatsapp!

/** On LinkedIn a stranger is reached with a connection request; elsewhere opening a conversation is a first message. */
export function defaultAction(channel: string, hasConversation: boolean): ActionKind {
  if (hasConversation) return "message"
  return channel === "linkedin" ? "invite" : "first_message"
}
