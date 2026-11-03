import { between, seeded } from "./random.ts"
import { HOUR } from "./time.ts"

/** What the platform said when the account tried to send. Channels report one of these; they never decide what it means. */
export const OUTCOMES = ["sent", "rate_limited", "limit_reached", "challenge", "auth_expired", "banned", "recipient_unavailable", "transport_error"] as const
export type Outcome = (typeof OUTCOMES)[number]

export type Pause = { scope: "account"; until: "backoff" } | { scope: "action"; until: "next_day" } | { scope: "account"; until: "human" }

export type OutcomePolicy = {
  /** The platform itself told us to slow down: the warmup ramp stops and halves. */
  pushback: boolean
  pause?: Pause
  /** Put the message back in the queue rather than failing it. */
  retry: boolean
}

/**
 * The one table that decides how a connection reacts to a result. Only an answer from the platform is evidence about
 * the account: a dropped proxy or a timeout says nothing about standing and must never throttle a healthy account.
 * A challenge is never retried automatically, since every automated retry against a checkpoint hardens the block.
 */
export const OUTCOME_POLICIES: Record<Outcome, OutcomePolicy> = {
  sent: { pushback: false, retry: false },
  rate_limited: { pushback: true, pause: { scope: "account", until: "backoff" }, retry: true },
  limit_reached: { pushback: true, pause: { scope: "action", until: "next_day" }, retry: true },
  challenge: { pushback: true, pause: { scope: "account", until: "human" }, retry: true },
  auth_expired: { pushback: false, pause: { scope: "account", until: "human" }, retry: true },
  banned: { pushback: true, pause: { scope: "account", until: "human" }, retry: false },
  recipient_unavailable: { pushback: false, retry: false },
  transport_error: { pushback: false, retry: true },
}

export const PUSHBACK_OUTCOMES = OUTCOMES.filter((o) => OUTCOME_POLICIES[o].pushback)
/** Attempts the platform saw and refused: activity on the account even though nothing went out. */
export const REFUSED_OUTCOMES = OUTCOMES.filter((o) => o !== "sent" && o !== "transport_error")

/** Pause after the `n`th rate limit in a row: an hour, doubling to a day, stretched up to half again so paused accounts don't wake together. */
export function backoffMs(n: number, seed: string): number {
  const base = Math.min(24 * HOUR, HOUR * 2 ** Math.max(0, n - 1))
  return Math.round(base * between(1, 1.5, seeded(seed, "backoff", n)))
}
