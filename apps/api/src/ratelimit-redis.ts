import { Redis } from "ioredis"
import type { RateLimiter } from "./ratelimit.ts"

// Kept apart from ratelimit.ts so the edge Worker (which uses Cloudflare's limiter) never bundles ioredis.

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
