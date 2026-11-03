export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Wall-clock parts of `date` in `timeZone`. `weekday` is 0 for Sunday. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const p: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(date)) p[part.type] = part.value
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second), weekday: WEEKDAYS.indexOf(p.weekday ?? ""),
  }
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** The instant the wall clock in `timeZone` reads this time. In a DST gap it lands just after the gap. */
export function fromLocal(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute)
  let guess = wanted
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone)
    const diff = wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

/** Midnight starting the local day after `date`'s. */
export function startOfNextLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone)
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1))
  return fromLocal(timeZone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}
