import { Redis } from "ioredis"

/**
 * The cross-worker coordinator (Phase 5). A connection's live socket is held by exactly one worker; Redis records
 * which (`parley:owner:<id>` → workerId, on a renewed lease), and commands for a connection this worker doesn't hold
 * are routed to its owner over pub/sub (request on `parley:rpc:<owner>`, reply on `parley:reply:<caller>`).
 *
 * Redis holds only the ownership registry and transient command/reply messages — never credentials. Sealed creds
 * move worker↔Postgres only.
 */
const OWNER = (id: string) => `parley:owner:${id}`
const RPC = (worker: string) => `parley:rpc:${worker}`
const REPLY = (worker: string) => `parley:reply:${worker}`
const LEASE_SECONDS = 300
const RENEW_MS = 120_000
const RPC_TIMEOUT_MS = 5_000

export type RpcRequest = { id: string; from: string; connId: string; op: string; args: Record<string, unknown> }
export type RpcHandler = (req: Omit<RpcRequest, "id" | "from">) => Promise<unknown>

export class RedisCoordinator {
  readonly workerId = crypto.randomUUID()
  readonly #pub: Redis
  readonly #sub: Redis
  readonly #pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  #handler: RpcHandler | undefined
  #renew: ReturnType<typeof setInterval> | undefined
  #owned = new Set<string>()

  constructor(url: string) {
    this.#pub = new Redis(url, { maxRetriesPerRequest: null })
    this.#sub = new Redis(url, { maxRetriesPerRequest: null })
  }

  async start(handler: RpcHandler): Promise<void> {
    this.#handler = handler
    await this.#sub.subscribe(RPC(this.workerId), REPLY(this.workerId))
    this.#sub.on("message", (channel, message) => void this.#onMessage(channel, message).catch(() => {}))
    this.#renew = setInterval(() => void this.#renewAll().catch(() => {}), RENEW_MS)
    if (typeof this.#renew.unref === "function") this.#renew.unref()
  }

  async claim(connId: string): Promise<void> {
    this.#owned.add(connId)
    await this.#pub.set(OWNER(connId), this.workerId, "EX", LEASE_SECONDS)
  }

  async release(connId: string): Promise<void> {
    this.#owned.delete(connId)
    // Only clear if we still own it (avoid deleting a successor's claim).
    const current = await this.#pub.get(OWNER(connId))
    if (current === this.workerId) await this.#pub.del(OWNER(connId))
  }

  async ownerOf(connId: string): Promise<string | undefined> {
    return (await this.#pub.get(OWNER(connId))) ?? undefined
  }

  async callOwner(owner: string, req: { connId: string; op: string; args: Record<string, unknown> }): Promise<unknown> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error("rpc timeout"))
      }, RPC_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      void this.#pub.publish(RPC(owner), JSON.stringify({ id, from: this.workerId, ...req } satisfies RpcRequest))
    })
  }

  async close(): Promise<void> {
    if (this.#renew) clearInterval(this.#renew)
    for (const { timer } of this.#pending.values()) clearTimeout(timer)
    this.#pending.clear()
    this.#pub.disconnect()
    this.#sub.disconnect()
  }

  async #renewAll(): Promise<void> {
    for (const connId of this.#owned) await this.#pub.set(OWNER(connId), this.workerId, "EX", LEASE_SECONDS, "XX")
  }

  async #onMessage(channel: string, message: string): Promise<void> {
    const m = JSON.parse(message)
    if (channel === REPLY(this.workerId)) {
      const pending = this.#pending.get(m.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(m.id)
      if (m.ok) pending.resolve(m.result)
      else pending.reject(new Error(m.error))
      return
    }
    // An RPC request addressed to this worker (we hold the connection).
    let reply: { id: string; ok: boolean; result?: unknown; error?: string }
    try {
      const result = await this.#handler!({ connId: m.connId, op: m.op, args: m.args })
      reply = { id: m.id, ok: true, result }
    } catch (e) {
      reply = { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    await this.#pub.publish(REPLY(m.from), JSON.stringify(reply))
  }
}
