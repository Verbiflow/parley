import type { ExecutionContext } from "hono"
import { readConfig, RequestDatabase, type IdentityConfig } from "@parley/auth"
import type { Channel } from "@parley/channels"
import { WHATSAPP_ID, WHATSAPP_CAPABILITIES } from "@parley/channels/whatsapp/meta"
import { makeApp } from "./app.ts"
import { makeContext } from "./context.ts"
import { RemoteSessions } from "./sessions/remote.ts"

/**
 * Production edge entrypoint (Cloudflare Worker at app.itsparley.com): the dashboard, WorkOS sign-in, the OAuth
 * server and the MCP endpoint. Postgres comes through Hyperdrive (which reaches the private RDS over a Cloudflare
 * Tunnel); live channel operations go to the EC2 sessions service through a Workers VPC binding. This bundle never
 * contains Baileys or Redis.
 */
type Env = {
  HYPERDRIVE: { connectionString: string }
  SESSIONS: { fetch: (input: string, init?: RequestInit) => Promise<Response> }
  SESSIONS_SECRET: string
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

let config: IdentityConfig | undefined

export default {
  async fetch(request: Request, env: Env, ectx: ExecutionContext): Promise<Response> {
    config ??= readConfig(Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as NodeJS.ProcessEnv)
    // One Postgres connection per request — Hyperdrive pools the real connections to RDS.
    const db = new RequestDatabase(env.HYPERDRIVE.connectionString)
    const transport = { fetch: (input: string, init: RequestInit) => env.SESSIONS.fetch(input, init), baseUrl: SESSIONS_BASE, secret: env.SESSIONS_SECRET }
    const ctx = makeContext(config, db, EDGE_CHANNELS, (sql) => new RemoteSessions(sql, transport))
    try {
      return await makeApp(ctx).fetch(request, env, ectx)
    } finally {
      ectx.waitUntil(db.close())
    }
  },
}
