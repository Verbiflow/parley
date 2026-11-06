import type { ActionKind, PacingPolicy } from "./policy.ts"
import { between, seeded } from "./random.ts"
import { DAY, MINUTE, fromLocal, localDate, localParts, startOfNextLocalDay } from "./time.ts"

export type Slot = {
  at: Date
  action: ActionKind
  /** The platform saw the account act but nothing was used up (an attempt it refused). Counts toward gaps and bursts, not caps. */
  activityOnly?: boolean
}

export type PlanInput = {
  policy: PacingPolicy
  timeZone: string
  /** Stable per connection; every jitter derives from it. */
  seed: string
  now: Date
  /** Every slot already taken: at least the trailing seven days and everything in the future. */
  reservations: Slot[]
  pausedUntil?: Date | null
  /** Go strictly after this (the last message already queued to the same chat), so a chat's messages keep their order. */
  after?: Date | null
  /** Paused until a person acts (a checkpoint, a ban, a relink). */
  pausedIndefinitely?: boolean
  /** Today's warmup allowance per action; the policy's daily limit when absent. */
  allowance?: Partial<Record<ActionKind, number>>
  /**
   * Sends a local day may hold across every kind. When set it replaces the per-kind daily caps and warmup: one number
   * the person chose. Spacing, gaps, breaks and weekly caps still apply.
   */
  dailyTotal?: number
  /** Keep to the policy's active hours and days. On unless set to false: off, the account sends at any hour. */
  activeHours?: boolean
}

/** Why a slot is later than `now`. */
export type Wait = "paused" | "queued" | "gap" | "outside_active_hours" | "break" | "action_spacing" | "daily_cap" | "weekly_cap"

export type PlanResult =
  | { ok: true; at: Date; waits: Wait[] }
  | { ok: false; reason: "action_unsupported" | "paused" | "no_capacity" }

const MAX_STEPS = 1000
const OPENING_JITTER = 20 * MINUTE

/**
 * The earliest time `action` may run on a connection, given everything already reserved on it. Actions of one kind
 * run in the order they were planned; kinds interleave, so a reply isn't stuck behind tomorrow's capped first
 * messages. Any two actions keep the minimum gap, on both sides. Deterministic: the same input gives the same slot.
 */
export function planNext(input: PlanInput, action: ActionKind): PlanResult {
  const { policy, timeZone, seed, now } = input
  const limit = policy.actions[action]
  if (!limit) return { ok: false, reason: "action_unsupported" }
  if (input.pausedIndefinitely) return { ok: false, reason: "paused" }
  const total = input.dailyTotal
  const cap = total ?? Math.min(limit.daily, input.allowance?.[action] ?? limit.daily)
  if (cap <= 0 || (limit.weekly ?? 1) <= 0) return { ok: false, reason: "no_capacity" }

  const slots = [...input.reservations].sort((a, b) => a.at.getTime() - b.at.getTime())
  const sameKind = slots.filter((s) => s.action === action && !s.activityOnly)
  // Under a total, every send counts toward the cap; otherwise only this kind does.
  const counted = total !== undefined ? slots.filter((s) => !s.activityOnly) : sameKind
  const waits = new Set<Wait>()
  let t = now.getTime()
  const pushTo = (at: number, why: Wait) => {
    if (at <= t) return false
    t = at
    waits.add(why)
    return true
  }
  const gapAfter = (ms: number) => between(policy.gapSeconds.min, policy.gapSeconds.max, seeded(seed, "gap", ms)) * 1000

  if (input.pausedUntil) pushTo(input.pausedUntil.getTime(), "paused")
  if (input.after) pushTo(input.after.getTime() + 1, "queued")
  const lastSame = sameKind.at(-1)
  if (lastSame) {
    const ms = lastSame.at.getTime()
    if (limit.spacingMinutes) pushTo(ms + between(limit.spacingMinutes.min, limit.spacingMinutes.max, seeded(seed, "spacing", action, ms)) * MINUTE, "action_spacing")
    else pushTo(ms + 1, "queued")
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    if (input.activeHours !== false && pushTo(nextActiveTime(t, policy, timeZone, seed), "outside_active_hours")) continue

    const prev = findLast(slots, (s) => s.at.getTime() <= t)
    if (prev && pushTo(prev.at.getTime() + gapAfter(prev.at.getTime()), "gap")) continue
    const next = slots.find((s) => s.at.getTime() > t)
    if (next && next.at.getTime() - t < policy.gapSeconds.min * 1000) {
      pushTo(next.at.getTime() + gapAfter(next.at.getTime()), "gap")
      continue
    }

    if (pushTo(breakUntil(slots, t, policy, seed), "break")) continue

    const day = localDate(new Date(t), timeZone)
    if (counted.filter((s) => localDate(s.at, timeZone) === day).length >= cap) {
      pushTo(startOfNextLocalDay(new Date(t), timeZone).getTime(), "daily_cap")
      continue
    }

    if (limit.weekly) {
      const inWeek = sameKind.filter((s) => s.at.getTime() > t - 7 * DAY && s.at.getTime() <= t)
      if (inWeek.length >= limit.weekly) {
        pushTo(inWeek[inWeek.length - limit.weekly]!.at.getTime() + 7 * DAY + 1, "weekly_cap")
        continue
      }
    }

    return { ok: true, at: new Date(t), waits: [...waits] }
  }
  return { ok: false, reason: "no_capacity" }
}

/** `t` if it is inside the active window, otherwise when the next window opens (plus a little jitter). */
function nextActiveTime(t: number, policy: PacingPolicy, timeZone: string, seed: string): number {
  const { start, end } = policy.activeHours
  const p = localParts(new Date(t), timeZone)
  if (policy.activeDays.includes(p.weekday) && p.hour >= start && p.hour < end) return t
  for (let d = 0; d <= 7; d++) {
    if (d === 0 && p.hour >= start) continue
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + d))
    if (!policy.activeDays.includes(date.getUTCDay())) continue
    const opens = fromLocal(timeZone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), start)
    return Math.max(t, opens.getTime() + seeded(seed, "opens", date.toISOString().slice(0, 10)) * OPENING_JITTER)
  }
  return t
}

/**
 * Activity comes in bursts: a run of slots with no gap of at least `breakMinutes.min` between them. Once a burst has
 * lasted its (seeded) length, the next slot waits out a break.
 */
function breakUntil(slots: Slot[], t: number, policy: PacingPolicy, seed: string): number {
  const minBreak = policy.breakMinutes.min * MINUTE
  let i = findLastIndex(slots, (s) => s.at.getTime() <= t)
  if (i < 0) return t
  const last = slots[i]!.at.getTime()
  if (t - last >= minBreak) return t
  while (i > 0 && slots[i]!.at.getTime() - slots[i - 1]!.at.getTime() < minBreak) i--
  const burstStart = slots[i]!.at.getTime()
  if (t - burstStart < between(policy.burstMinutes.min, policy.burstMinutes.max, seeded(seed, "burst", burstStart)) * MINUTE) return t
  return Math.max(t, last + between(policy.breakMinutes.min, policy.breakMinutes.max, seeded(seed, "break", burstStart)) * MINUTE)
}

function findLastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i]!)) return i
  return -1
}

function findLast<T>(items: T[], pred: (item: T) => boolean): T | undefined {
  const i = findLastIndex(items, pred)
  return i < 0 ? undefined : items[i]
}
