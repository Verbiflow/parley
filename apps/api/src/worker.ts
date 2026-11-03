import type { ExecutionContext } from "hono"
import { readConfig, RequestDatabase, tokenKeys, type IdentityConfig } from "@parley/auth"
import type { Channel } from "@parley/channels"
import { WHATSAPP_ID, WHATSAPP_CAPABILITIES } from "@parley/channels/whatsapp/meta"
import { makeApp } from "./app.ts"
import { ACCESS_TOKEN_SECONDS } from "./access.ts"
import type { AppContext } from "./context.ts"
import { Transactor } from "./db/transactor.ts"
import { LIMITS, type RateLimiter } from "./ratelimit.ts"
import { Exits } from "./sessions/exits.ts"
import { RemoteSessions } from "./sessions/remote.ts"

/**
 * Production edge entrypoint (Cloudflare Worker at app.itsparley.com): the dashboard, WorkOS sign-in, the OAuth
 * server and the MCP endpoint. Postgres comes through Hyperdrive (which reaches the private RDS over a Cloudflare
 * Tunnel); live channel operations and outbox writes go to the EC2 sessions service through a Workers VPC binding.
 * This bundle never contains Baileys or Redis (`context.ts` is imported for its types and a constant only).
 */
type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> }
type Env = {
  HYPERDRIVE: { connectionString: string }
  SESSIONS: { fetch: (input: string, init?: RequestInit) => Promise<Response> }
  SESSIONS_SECRET: string
  RL_MCP: RateLimitBinding
  RL_SIGNIN: RateLimitBinding
  RL_DASHBOARD: RateLimitBinding
  [key: string]: unknown
}

/** Channels as the edge sees them: identity and capabilities only. Opening one happens on the sessions service. */
const EDGE_CHANNELS: Channel[] = [
  {
    id: WHATSAPP_ID,
    capabilities: WHATSAPP_CAPABILITIES,
    open: () => Promise.reject(new Error("channels open on the sessions service, not the edge")),
  },
]

// The base URL's host is only a label: the VPC binding decides where the request actually goes.
const SESSIONS_BASE = "http://parley-sessions"

/**
 * Rate limits on Cloudflare's native limiter, shared across the edge (a per-isolate counter would barely limit
 * anything). Each `LIMITS` rule has its own binding, configured with the same numbers in wrangler.jsonc; keys are
 * `<rule>:<who>` as `app.ts` builds them.
 */
function bindingLimiter(env: Env): RateLimiter {
  const rules: Record<string, [RateLimitBinding, number]> = {
    mcp: [env.RL_MCP, LIMITS.mcp.windowSeconds],
    "sign-in": [env.RL_SIGNIN, LIMITS.signIn.windowSeconds],
    dashboard: [env.RL_DASHBOARD, LIMITS.dashboardWrite.windowSeconds],
  }
  return {
    async hit(key) {
      const rule = rules[key.slice(0, key.indexOf(":"))]
      if (!rule) return 0
      const { success } = await rule[0].limit({ key })
      return success ? 0 : rule[1]
    },
    async close() {},
  }
}

let config: IdentityConfig | undefined
let exits: Exits | undefined

export default {
  async fetch(request: Request, env: Env, ectx: ExecutionContext): Promise<Response> {
    config ??= readConfig(Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as NodeJS.ProcessEnv)
    exits ??= new Exits(config)
    // Connections are per request (Workers can't share sockets across requests); Hyperdrive pools the real ones.
    const db = new RequestDatabase(env.HYPERDRIVE.connectionString)
    const tx = new Transactor(env.HYPERDRIVE.connectionString)
    const transport = { fetch: (input: string, init: RequestInit) => env.SESSIONS.fetch(input, init), baseUrl: SESSIONS_BASE, secret: env.SESSIONS_SECRET }
    const ctx: AppContext = {
      config,
      db,
      sql: db.query,
      tx,
      accessTokenKeys: tokenKeys({ signingKey: config.signingKey, verifyKeys: config.verifyKeys, tokenSeconds: ACCESS_TOKEN_SECONDS }, config.env),
      channels: EDGE_CHANNELS,
      sessions: new RemoteSessions(db.query, transport),
      exits,
      limiter: bindingLimiter(env),
      async close() {
        await Promise.all([db.close(), tx.close()])
      },
    }
    try {
      return await makeApp(ctx).fetch(request, env, ectx)
    } finally {
      ectx.waitUntil(ctx.close())
    }
  },
}
