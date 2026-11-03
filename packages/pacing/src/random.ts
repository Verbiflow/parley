/**
 * Deterministic randomness keyed by a string. The planner derives every jitter from (connection id, the slot it is
 * jittering), so planning the same queue twice yields the same times instead of reshuffling on every request.
 */
export function seeded(...parts: Array<string | number>): number {
  let h = 2166136261
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  let t = (h += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const between = (min: number, max: number, r: number) => min + (max - min) * r
