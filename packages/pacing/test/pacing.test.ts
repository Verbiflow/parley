import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DAY, MINUTE, POLICIES, allowanceFor, backoffMs, defaultAction, localDate, localParts, nextAllowance, planNext,
  type ActionKind, type PacingPolicy, type PlanInput, type Slot,
} from "../src/index.ts"

const NY = "America/New_York"
// Tuesday 2026-11-03, 10:00 in New York
const TUESDAY_10AM = new Date("2026-11-03T15:00:00Z")
const linkedin = POLICIES.linkedin!
const whatsapp = POLICIES.whatsapp!

/** Plan `n` actions one after another, the way an outbox fills. */
function fill(policy: PacingPolicy, action: ActionKind, n: number, now: Date, extra: Partial<PlanInput> = {}): Slot[] {
  const reservations: Slot[] = []
  for (let i = 0; i < n; i++) {
    const r = planNext({ policy, timeZone: NY, seed: "conn", now, reservations, ...extra }, action)
    if (!r.ok) throw new Error(`slot ${i}: ${r.reason}`)
    reservations.push({ at: r.at, action })
  }
  return reservations
}

const perDay = (slots: Slot[]) => {
  const counts = new Map<string, number>()
  for (const s of slots) counts.set(localDate(s.at, NY), (counts.get(localDate(s.at, NY)) ?? 0) + 1)
  return Math.max(...counts.values())
}

test("an idle connection inside active hours sends now", () => {
  assert.deepEqual(planNext({ policy: whatsapp, timeZone: NY, seed: "a", now: TUESDAY_10AM, reservations: [] }, "message"), { ok: true, at: TUESDAY_10AM, waits: [] })
})

test("outside active hours it waits for the window, opening a few minutes after the hour", () => {
  const r = planNext({ policy: linkedin, timeZone: NY, seed: "a", now: new Date("2026-11-03T08:00:00Z"), reservations: [] }, "message")
  assert.ok(r.ok)
  const p = localParts(r.at, NY)
  assert.equal(p.hour, 8)
  assert.ok(p.minute < 20)
  assert.deepEqual(r.waits, ["outside_active_hours"])
})

test("with active hours off it sends at any hour, any day", () => {
  const night = new Date("2026-11-07T08:00:00Z") // 3 AM on a Saturday in New York
  assert.deepEqual(planNext({ policy: linkedin, timeZone: NY, seed: "a", now: night, reservations: [], activeHours: false }, "message"), { ok: true, at: night, waits: [] })
})

test("it skips days the policy doesn't work (LinkedIn on a Saturday)", () => {
  const r = planNext({ policy: linkedin, timeZone: NY, seed: "a", now: new Date("2026-11-07T17:00:00Z"), reservations: [] }, "message")
  assert.ok(r.ok)
  assert.equal(localDate(r.at, NY), "2026-11-09")
})

test("planning is deterministic", () => {
  assert.deepEqual(fill(linkedin, "invite", 30, TUESDAY_10AM), fill(linkedin, "invite", 30, TUESDAY_10AM))
})

test("every slot is inside active hours with at least the minimum gap", () => {
  const slots = fill(whatsapp, "message", 600, TUESDAY_10AM)
  for (const s of slots) {
    const { hour } = localParts(s.at, NY)
    assert.ok(hour >= whatsapp.activeHours.start && hour < whatsapp.activeHours.end)
  }
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i]!.at.getTime() - slots[i - 1]!.at.getTime() >= whatsapp.gapSeconds.min * 1000)
})

test("daily caps and the warmup allowance are never exceeded", () => {
  assert.equal(perDay(fill(linkedin, "invite", 45, TUESDAY_10AM)), 20)
  assert.equal(perDay(fill(whatsapp, "first_message", 12, TUESDAY_10AM, { allowance: { first_message: 3 } })), 3)
})

test("a daily total caps every kind together, and replaces the per-kind caps", () => {
  const reservations: Slot[] = []
  for (let i = 0; i < 30; i++) {
    const action: ActionKind = i % 3 === 0 ? "first_message" : "message"
    const r = planNext({ policy: whatsapp, timeZone: NY, seed: "conn", now: TUESDAY_10AM, reservations, dailyTotal: 10, allowance: { message: 1, first_message: 1 } }, action)
    assert.ok(r.ok)
    reservations.push({ at: r.at, action })
  }
  assert.equal(perDay(reservations), 10)
  // Openers aren't held to their own (warmup) cap under a total: 10 a day across both kinds.
  assert.equal(perDay(fill(whatsapp, "first_message", 12, TUESDAY_10AM, { dailyTotal: 10, allowance: { first_message: 3 } })), 10)
})

test("the rolling weekly cap holds over any seven days", () => {
  const times = fill(linkedin, "invite", 160, TUESDAY_10AM).map((s) => s.at.getTime())
  for (const t of times) assert.ok(times.filter((u) => u > t - 7 * DAY && u <= t).length <= 100)
})

test("a day's quota spreads out instead of landing in the first hour", () => {
  const slots = fill(linkedin, "invite", 20, TUESDAY_10AM)
  for (let i = 1; i < slots.length; i++) {
    if (localDate(slots[i]!.at, NY) === localDate(slots[i - 1]!.at, NY)) assert.ok(slots[i]!.at.getTime() - slots[i - 1]!.at.getTime() >= 12 * MINUTE)
  }
  assert.ok(localParts(slots[19]!.at, NY).hour >= 16, "the 20th invite lands in the afternoon")
})

test("activity comes in bursts with breaks between them", () => {
  // Slow gaps, so 200 sends outlast several bursts (at WhatsApp's default few seconds they'd fit in one).
  const slow: PacingPolicy = { ...whatsapp, gapSeconds: { min: 30, max: 150 } }
  const slots = fill(slow, "message", 200, TUESDAY_10AM)
  let burstStart = slots[0]!.at.getTime()
  let breaks = 0
  for (let i = 1; i < slots.length; i++) {
    const gap = slots[i]!.at.getTime() - slots[i - 1]!.at.getTime()
    if (gap >= whatsapp.breakMinutes.min * MINUTE) {
      breaks++
      burstStart = slots[i]!.at.getTime()
    } else {
      assert.ok(slots[i]!.at.getTime() - burstStart <= slow.burstMinutes.max * MINUTE + slow.gapSeconds.max * 1000)
    }
  }
  assert.ok(breaks > 3)
})

test("a reply isn't stuck behind first messages capped until tomorrow", () => {
  const capped = fill(whatsapp, "first_message", 4, TUESDAY_10AM, { allowance: { first_message: 3 } })
  assert.notEqual(localDate(capped[3]!.at, NY), localDate(TUESDAY_10AM, NY))
  const reply = planNext({ policy: whatsapp, timeZone: NY, seed: "conn", now: TUESDAY_10AM, reservations: capped, allowance: { first_message: 3 } }, "message")
  assert.ok(reply.ok && localDate(reply.at, NY) === localDate(TUESDAY_10AM, NY))
})

test("the window holds across a DST change", () => {
  for (const s of fill(whatsapp, "message", 400, new Date("2026-10-30T13:00:00Z"))) assert.ok(localParts(s.at, NY).hour >= 8)
})

test("pauses and unsupported actions", () => {
  const base = { policy: linkedin, timeZone: NY, seed: "a", now: TUESDAY_10AM, reservations: [] }
  assert.deepEqual(planNext({ ...base, pausedIndefinitely: true }, "message"), { ok: false, reason: "paused" })
  assert.deepEqual(planNext({ ...base, policy: whatsapp }, "invite"), { ok: false, reason: "action_unsupported" })
  const until = new Date(TUESDAY_10AM.getTime() + 2 * 3600_000)
  const r = planNext({ ...base, pausedUntil: until }, "message")
  assert.ok(r.ok && r.at >= until && r.waits.includes("paused"))
})

test("warmup grows only after a day that used its allowance, and halves on pushback", () => {
  const limit = linkedin.actions.invite!
  assert.equal(nextAllowance({ current: 5, limit, used: 5, pushback: false }), 6)
  assert.equal(nextAllowance({ current: 10, limit, used: 8, pushback: false }), 12)
  assert.equal(nextAllowance({ current: 10, limit, used: 3, pushback: false }), 10)
  assert.equal(nextAllowance({ current: 20, limit, used: 20, pushback: false }), 20)
  assert.equal(nextAllowance({ current: 12, limit, used: 12, pushback: true }), 6)
  const first = allowanceFor({ entry: undefined, limit, today: "2026-11-03", usedOn: () => 0, pushbackSince: () => false })
  assert.deepEqual(first, { allowance: 5, on: "2026-11-03" })
  assert.equal(allowanceFor({ entry: first, limit, today: "2026-11-03", usedOn: () => 5, pushbackSince: () => false }), first)
  assert.deepEqual(allowanceFor({ entry: first, limit, today: "2026-11-04", usedOn: () => 5, pushbackSince: () => false }), { allowance: 6, on: "2026-11-04" })
})

test("backoff doubles from an hour to a day", () => {
  assert.ok(backoffMs(1, "a") >= 3600_000 && backoffMs(1, "a") <= 5400_000)
  assert.ok(backoffMs(3, "a") >= 4 * 3600_000)
  assert.ok(backoffMs(10, "a") <= 36 * 3600_000)
})

test("strangers get an invite on LinkedIn and a first message elsewhere", () => {
  assert.equal(defaultAction("linkedin", false), "invite")
  assert.equal(defaultAction("whatsapp", false), "first_message")
  assert.equal(defaultAction("whatsapp", true), "message")
})
