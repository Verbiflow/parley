import { Redis } from "ioredis"

/** Allows or refuses one request for a key within a fixed window. */
export interface RateLimiter {
  /** Seconds until the key may try again, or 0 if this request is allowed. */
  hit(key: string, limit: number, windowSeconds: number): Promise<number>
  close(): Promise<void>
}

/** One process's memory: local dev and tests. With several workers, each would count separately. */
export function memoryLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { resetAt: number; count: number }>()
  return {
    async hit(key, limit, windowSeconds) {
      const t = now()
      let w = windows.get(key)
      if (!w || t >= w.resetAt) windows.set(key, (w = { resetAt: t + windowSeconds * 1000, count: 0 }))
      w.count++
      return w.count <= limit ? 0 : Math.ceil((w.resetAt - t) / 1000)
    },
    async close() {},
  }
}

/** Shared across the fleet in Redis: INCR a per-window key, expiring with the window. */
export function redisLimiter(url: string): RateLimiter {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 })
  return {
    async hit(key, limit, windowSeconds) {
      const window = Math.floor(Date.now() / 1000 / windowSeconds)
      const k = `parley:rl:${key}:${window}`
      const [[, count], [, ttl]] = (await redis.multi().incr(k).ttl(k).exec()) as [[unknown, number], [unknown, number]]
      if (ttl < 0) await redis.expire(k, windowSeconds)
      return count <= limit ? 0 : Math.max(1, ttl > 0 ? ttl : windowSeconds)
    },
    async close() {
      redis.disconnect()
    },
  }
}

/** Requests per minute. Agents get room for bursts of tool calls; sign-in endpoints get little room for guessing. */
export const LIMITS = {
  mcp: { limit: 300, windowSeconds: 60 },
  signIn: { limit: 20, windowSeconds: 60 },
  dashboardWrite: { limit: 60, windowSeconds: 60 },
}
