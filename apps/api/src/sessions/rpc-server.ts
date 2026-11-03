import { createHash, timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import { ConnectError, LIVE_OPS, type LiveOp, type Sessions } from "./actor.ts"
import { OutboxError } from "./outbox.ts"

/**
 * The sessions service's internal API (runs on the EC2 box that holds the channel sockets). The edge Worker reaches it
 * only through a Cloudflare Tunnel (Workers VPC service) — it has no public hostname — and every call must also carry
 * the shared `SESSIONS_SECRET` as a bearer token, so a misrouted request is still refused.
 *
 * Wire format: `POST /rpc/<op>` with `{ "args": [...] }` → `200 { result }`, or `4xx { error: { code, message } }`.
 * Only the live operations in `LIVE_OPS` are callable; account-ownership checks happen inside `Sessions` as usual.
 */
export function rpcApp(sessions: Sessions, secret: string): Hono {
  if (secret.length < 32) throw new Error("SESSIONS_SECRET must be at least 32 characters")
  const expected = digest(secret)
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true }))

  app.post("/rpc/:op", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1]
    if (!token || !timingSafeEqual(digest(token), expected)) return c.json({ error: { code: "unauthorized", message: "unauthorized" } }, 401)

    const op = c.req.param("op") as LiveOp
    if (!LIVE_OPS.includes(op)) return c.json({ error: { code: "unknown_op", message: "unknown op" } }, 404)
    const body = await c.req.json().catch(() => undefined)
    const args = (body as { args?: unknown })?.args
    if (!Array.isArray(args)) return c.json({ error: { code: "bad_request", message: "expected { args: [...] }" } }, 400)

    // JSON carries dates as strings; the outbox compares `notBefore` as a Date. Callers never pass `now` (args past
    // the documented ones are dropped) — this service's clock decides pacing.
    if (op === "enqueue") {
      args.length = Math.min(args.length, 3)
      const req = args[2] as { notBefore?: unknown } | undefined
      if (req && typeof req.notBefore === "string") req.notBefore = new Date(req.notBefore)
    }
    if (op === "setLocale") args.length = Math.min(args.length, 3)

    try {
      const fn = sessions[op] as (...a: unknown[]) => Promise<unknown>
      const result = await fn.apply(sessions, args)
      return c.json({ result: result ?? null })
    } catch (e) {
      // Typed errors cross the wire with their class, so the edge can rebuild them (MCP and the dashboard branch on them).
      if (e instanceof ConnectError || e instanceof OutboxError) return c.json({ error: { type: e.name, code: e.code, message: e.message } }, 400)
      console.error(JSON.stringify({ msg: "rpc failed", op, error: e instanceof Error ? e.message : String(e) }))
      return c.json({ error: { code: "internal", message: "internal error" } }, 500)
    }
  })

  return app
}

const digest = (s: string) => createHash("sha256").update(s).digest()
