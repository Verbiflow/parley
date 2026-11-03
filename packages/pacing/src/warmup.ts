import type { ActionKind, ActionLimit } from "./policy.ts"

export type WarmupEntry = { allowance: number; /** Local date (`YYYY-MM-DD`) the allowance was set for. */ on: string }
export type WarmupState = Partial<Record<ActionKind, WarmupEntry>>

/** A day counts as having used its allowance at this fraction; only then does the ramp step up. */
const USED_FRACTION = 0.8

/**
 * Tomorrow's allowance from today's. Growth is earned: it steps up only after a day that used most of its allowance
 * with no pushback, and never by more than `growth` times. Pushback (a rate limit, a stated cap, a checkpoint) halves
 * it the same day, because the platform just said where the line is.
 */
export function nextAllowance(args: { current: number; limit: ActionLimit; used: number; pushback: boolean }): number {
  const { current, limit, used, pushback } = args
  if (pushback) return Math.max(1, Math.floor(current / 2))
  if (used >= Math.ceil(current * USED_FRACTION)) return Math.min(limit.daily, Math.max(current + 1, Math.round(current * limit.warmup.growth)))
  return Math.min(current, limit.daily)
}

/** The allowance for `today`, rolling the entry forward at most once a day. */
export function allowanceFor(args: {
  entry: WarmupEntry | undefined
  limit: ActionLimit
  today: string
  usedOn: (date: string) => number
  pushbackSince: (date: string) => boolean
}): WarmupEntry {
  const { entry, limit, today } = args
  if (!entry) return { allowance: limit.warmup.start, on: today }
  if (entry.on >= today) return entry
  return { allowance: nextAllowance({ current: entry.allowance, limit, used: args.usedOn(entry.on), pushback: args.pushbackSince(entry.on) }), on: today }
}
