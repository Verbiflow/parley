import { SignInKey, serverSeal, type IdentityConfig, type SecretSeal, type Sql } from "@parley/auth"
import { PRESETS, formatProxyUrl, gatewayEndpoint, newSessionId, parseProxyUrl, resolveGateway, type Credentials, type GatewayConfig, type PresetId, type ProxyKind } from "@parley/proxies"
import type { Transactor } from "../db/transactor.ts"

/** Consecutive transport failures before an exit is taken out of rotation. */
export const EXIT_FAILURE_LIMIT = 3

export class ExitError extends Error {
  readonly code: "not_found" | "invalid" | "no_exit"
  constructor(code: ExitError["code"], message: string) {
    super(message)
    this.name = "ExitError"
    this.code = code
  }
}

export type Provider = {
  id: string; accountId: string | null; name: string; type: "gateway" | "static"; kind: ProxyKind; preset: string | null
  gateway: GatewayConfig | null; countries: string[]; maxExits: number | null; enabled: boolean; createdAt: string; exits: number; assigned: number
}
export type Exit = {
  id: string; providerId: string; kind: ProxyKind; country: string; status: "active" | "cooling" | "burned" | "retired"
  lastIp: string | null; lastCheckedAt: string | null; connectionId: string | null
}

type SealedCols = { sealed_version: string | null; sealed_key_id: string | null; sealed_iv: string | null; sealed: string | null }
type ExitRow = SealedCols & { id: string; provider_id: string; kind: ProxyKind; country: string; session_id: string | null; status: Exit["status"]; last_ip: string | null; last_checked_at: Date | null; consecutive_failures: number }

const RANK = (col: string) => `case ${col} when 'mobile' then 0 when 'isp' then 1 when 'residential' then 2 else 3 end`
const binding = (owner: string | null, purpose: "provider" | "exit", id: string, version: string) =>
  ({ userId: owner ?? "hosted", kind: "proxy-creds" as const, purpose, name: id, version })

/**
 * The proxy layer: providers (where exit IPs come from), exits (one endpoint each), and which connection sends
 * through which. Credentials are sealed with the environment's key, bound to their row.
 */
export class Exits {
  #seal: SecretSeal | undefined
  readonly #config: IdentityConfig

  constructor(config: IdentityConfig) {
    this.#config = config
  }

  async #sealer(): Promise<SecretSeal> {
    return (this.#seal ??= serverSeal(await SignInKey.from(this.#config.signInKey)))
  }

  async #sealValue(owner: string | null, purpose: "provider" | "exit", id: string, value: string) {
    const version = crypto.randomUUID()
    const s = await (await this.#sealer()).seal(binding(owner, purpose, id, version), new TextEncoder().encode(value))
    return { version, keyId: s.keyId, iv: s.iv, sealed: s.sealed }
  }

  async #open(owner: string | null, purpose: "provider" | "exit", id: string, row: SealedCols): Promise<string> {
    const bytes = await (await this.#sealer()).open(binding(owner, purpose, id, row.sealed_version!), { scheme: "server.v1", keyId: row.sealed_key_id!, iv: row.sealed_iv!, sealed: row.sealed! })
    if (!bytes) throw new Error(`proxy credentials for ${purpose} ${id} don't open`)
    return new TextDecoder().decode(bytes)
  }

  async addGateway(
    sql: Sql, accountId: string | null,
    req: { name: string; kind: ProxyKind; preset?: PresetId | undefined; gateway?: Partial<GatewayConfig> | undefined; credentials: Credentials; countries?: string[] | undefined; maxExits?: number | undefined }
  ): Promise<Provider> {
    let gateway: GatewayConfig
    try {
      gateway = resolveGateway(req.preset ?? null, req.gateway ?? {})
    } catch (e) {
      throw new ExitError("invalid", e instanceof Error ? e.message : "incomplete gateway")
    }
    const id = crypto.randomUUID()
    const s = await this.#sealValue(accountId, "provider", id, JSON.stringify(req.credentials))
    await sql(
      `insert into parley.proxy_provider (id, account_id, name, type, kind, preset, gateway, countries, max_exits, sealed_version, sealed_key_id, sealed_iv, sealed)
       values ($1, $2, $3, 'gateway', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, accountId, req.name, req.kind, req.preset ?? null, JSON.stringify(gateway), (req.countries ?? []).map((c) => c.toUpperCase()), req.maxExits ?? null, s.version, s.keyId, s.iv, s.sealed]
    )
    return (await this.providers(sql, accountId)).find((p) => p.id === id)!
  }

  async addStatic(sql: Sql, accountId: string | null, req: { name: string; kind: ProxyKind; exits: Array<{ url: string; country: string }> }): Promise<Provider> {
    for (const e of req.exits) {
      try {
        parseProxyUrl(e.url)
      } catch (err) {
        throw new ExitError("invalid", err instanceof Error ? err.message : "bad proxy URL")
      }
      if (!/^[A-Za-z]{2}$/.test(e.country)) throw new ExitError("invalid", `"${e.country}" isn't a two-letter country code`)
    }
    const [row] = await sql<{ id: string }>(`insert into parley.proxy_provider (account_id, name, type, kind) values ($1, $2, 'static', $3) returning id`, [accountId, req.name, req.kind])
    await this.addStaticExits(sql, accountId, row!.id, req.exits)
    return (await this.providers(sql, accountId)).find((p) => p.id === row!.id)!
  }

  async addStaticExits(sql: Sql, accountId: string | null, providerId: string, exits: Array<{ url: string; country: string }>): Promise<void> {
    const [p] = await sql<{ type: string; kind: ProxyKind }>(`select type, kind from parley.proxy_provider where id = $1 and account_id is not distinct from $2::uuid`, [providerId, accountId])
    if (!p) throw new ExitError("not_found", "no such provider")
    if (p.type !== "static") throw new ExitError("invalid", "gateway providers mint an exit per connection; only static providers take a list")
    for (const e of exits) {
      const id = crypto.randomUUID()
      const s = await this.#sealValue(accountId, "exit", id, e.url)
      await sql(
        `insert into parley.proxy_exit (id, provider_id, kind, country, sealed_version, sealed_key_id, sealed_iv, sealed) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, providerId, p.kind, e.country.toUpperCase(), s.version, s.keyId, s.iv, s.sealed]
      )
    }
  }

  async setEnabled(sql: Sql, accountId: string, providerId: string, enabled: boolean): Promise<void> {
    const rows = await sql(`update parley.proxy_provider set enabled = $3 where id = $1 and account_id = $2 returning id`, [providerId, accountId, enabled])
    if (!rows.length) throw new ExitError("not_found", "no such provider")
  }

  async removeProvider(sql: Sql, accountId: string, providerId: string): Promise<void> {
    const rows = await sql(`delete from parley.proxy_provider where id = $1 and account_id = $2 returning id`, [providerId, accountId])
    if (!rows.length) throw new ExitError("not_found", "no such provider")
  }

  async providers(sql: Sql, accountId: string | null): Promise<Provider[]> {
    const rows = await sql<{ id: string; account_id: string | null; name: string; type: Provider["type"]; kind: ProxyKind; preset: string | null; gateway: GatewayConfig | null; countries: string[]; max_exits: number | null; enabled: boolean; created_at: Date; exits: number; assigned: number }>(
      `select p.id, p.account_id, p.name, p.type, p.kind, p.preset, p.gateway, p.countries, p.max_exits, p.enabled, p.created_at,
              (select count(*)::int from parley.proxy_exit e where e.provider_id = p.id) as exits,
              (select count(*)::int from parley.proxy_exit e join parley.proxy_assignment a on a.exit_id = e.id and a.released_at is null where e.provider_id = p.id) as assigned
         from parley.proxy_provider p where p.account_id is not distinct from $1::uuid order by p.created_at`,
      [accountId]
    )
    return rows.map((r) => ({
      id: r.id, accountId: r.account_id, name: r.name, type: r.type, kind: r.kind, preset: r.preset, gateway: r.gateway, countries: r.countries,
      maxExits: r.max_exits, enabled: r.enabled, createdAt: r.created_at.toISOString(), exits: r.exits, assigned: r.assigned,
    }))
  }

  async exits(sql: Sql, accountId: string): Promise<Exit[]> {
    const rows = await sql<ExitRow & { connection_id: string | null }>(
      `select e.*, a.connection_id from parley.proxy_exit e join parley.proxy_provider p on p.id = e.provider_id
         left join parley.proxy_assignment a on a.exit_id = e.id and a.released_at is null
        where p.account_id = $1 order by e.created_at`,
      [accountId]
    )
    return rows.map((r) => ({ id: r.id, providerId: r.provider_id, kind: r.kind, country: r.country, status: r.status, lastIp: r.last_ip, lastCheckedAt: r.last_checked_at?.toISOString() ?? null, connectionId: r.connection_id }))
  }

  /** Does this account route through proxies at all? Its own providers, or the hosted pool, enabled. */
  async proxied(sql: Sql, accountId: string): Promise<boolean> {
    const [r] = await sql<{ yes: boolean }>(`select exists (select 1 from parley.proxy_provider where enabled and (account_id = $1 or account_id is null)) as yes`, [accountId])
    return Boolean(r?.yes)
  }

  /**
   * The connection's exit URL, assigning one if it has none. A connection keeps one exit while it stays healthy: a
   * stable IP in the account's own country is what a person looks like, and rotation is a signal.
   *
   * In order: the live exit; an unassigned existing exit in the country that never fronted a different connection
   * on the same channel (platforms link accounts by IP history, not only the current IP); a fresh session minted
   * from a gateway. The account's own providers come before the hosted pool, mobile before ISP before residential
   * before datacenter. Undefined when the account doesn't use proxies; throws when it does and none fits.
   */
  async exitFor(tx: Transactor, c: { id: string; accountId: string; channel: string; country: string | null }): Promise<{ id: string; url: string } | undefined> {
    return tx.transaction(async (sql) => {
      const live = await this.#liveExit(sql, c.id)
      if (live) return { id: live.id, url: await this.#url(sql, live) }
      if (!(await this.proxied(sql, c.accountId))) return undefined
      if (!c.country) throw new ExitError("no_exit", "set the connection's country so Parley can pick an exit there")

      const [reuse] = await sql<ExitRow>(
        `select e.* from parley.proxy_exit e join parley.proxy_provider p on p.id = e.provider_id
          where e.status = 'active' and p.enabled and (p.account_id = $1 or p.account_id is null) and e.country = $2
            and not exists (select 1 from parley.proxy_assignment a where a.exit_id = e.id and a.released_at is null)
            and not exists (select 1 from parley.proxy_assignment a where a.exit_id = e.id and a.channel = $3 and a.connection_id <> $4)
          order by p.account_id is null, ${RANK("e.kind")}, e.consecutive_failures, e.created_at limit 1
          for update of e skip locked`,
        [c.accountId, c.country, c.channel, c.id]
      )
      const exit = reuse ?? (await this.#mint(sql, c.accountId, c.country))
      if (!exit) throw new ExitError("no_exit", `no proxy exit available in ${c.country}`)
      await sql(`insert into parley.proxy_assignment (exit_id, connection_id, channel) values ($1, $2, $3)`, [exit.id, c.id, c.channel])
      return { id: exit.id, url: await this.#url(sql, exit) }
    })
  }

  async #liveExit(sql: Sql, connectionId: string): Promise<ExitRow | undefined> {
    const [r] = await sql<ExitRow>(
      `select e.* from parley.proxy_assignment a join parley.proxy_exit e on e.id = a.exit_id where a.connection_id = $1 and a.released_at is null`,
      [connectionId]
    )
    return r
  }

  async #mint(sql: Sql, accountId: string, country: string): Promise<ExitRow | undefined> {
    const [p] = await sql<{ id: string; kind: ProxyKind }>(
      `select p.id, p.kind from parley.proxy_provider p
        where p.type = 'gateway' and p.enabled and (p.account_id = $1 or p.account_id is null)
          and (cardinality(p.countries) = 0 or $2 = any(p.countries))
          and (p.max_exits is null or (select count(*) from parley.proxy_exit e where e.provider_id = p.id) < p.max_exits)
        order by p.account_id is null, ${RANK("p.kind")}, p.created_at limit 1
        for update of p skip locked`,
      [accountId, country]
    )
    if (!p) return undefined
    const [e] = await sql<ExitRow>(`insert into parley.proxy_exit (provider_id, kind, country, session_id) values ($1, $2, $3, $4) returning *`, [p.id, p.kind, country, newSessionId()])
    return e
  }

  async #url(sql: Sql, exit: ExitRow): Promise<string> {
    const [p] = await sql<SealedCols & { id: string; account_id: string | null; gateway: GatewayConfig | null }>(
      `select id, account_id, gateway, sealed_version, sealed_key_id, sealed_iv, sealed from parley.proxy_provider where id = $1`,
      [exit.provider_id]
    )
    if (!p) throw new Error(`exit ${exit.id} has no provider`)
    if (exit.sealed) return this.#open(p.account_id, "exit", exit.id, exit)
    const credentials = JSON.parse(await this.#open(p.account_id, "provider", p.id, p)) as Credentials
    return formatProxyUrl(gatewayEndpoint(p.gateway!, credentials, { id: exit.session_id!, country: exit.country }))
  }

  /** The exit failed before reaching the platform. Repeated failures retire it from rotation and free the connection. */
  async recordFailure(tx: Transactor, exitId: string): Promise<void> {
    await tx.transaction(async (sql) => {
      const [e] = await sql<{ consecutive_failures: number }>(
        `update parley.proxy_exit set consecutive_failures = consecutive_failures + 1, last_checked_at = now() where id = $1 returning consecutive_failures`,
        [exitId]
      )
      if (e && e.consecutive_failures >= EXIT_FAILURE_LIMIT) {
        await sql(`update parley.proxy_exit set status = 'cooling' where id = $1`, [exitId])
        await sql(`update parley.proxy_assignment set released_at = now(), release_reason = 'exit_unhealthy' where exit_id = $1 and released_at is null`, [exitId])
      }
    })
  }

  async recordSuccess(sql: Sql, exitId: string, ip?: string): Promise<{ ipChanged: boolean }> {
    const [before] = await sql<{ last_ip: string | null }>(`select last_ip from parley.proxy_exit where id = $1`, [exitId])
    await sql(`update parley.proxy_exit set consecutive_failures = 0, last_checked_at = now(), last_ip = coalesce($2, last_ip) where id = $1`, [exitId, ip ?? null])
    return { ipChanged: Boolean(ip && before?.last_ip && before.last_ip !== ip) }
  }

  /** The account was banned through this exit; it must never front another account. */
  async burn(sql: Sql, exitId: string): Promise<void> {
    await sql(`update parley.proxy_exit set status = 'burned' where id = $1`, [exitId])
    await sql(`update parley.proxy_assignment set released_at = now(), release_reason = 'account_banned' where exit_id = $1 and released_at is null`, [exitId])
  }

  async liveExitId(sql: Sql, connectionId: string): Promise<string | undefined> {
    return (await this.#liveExit(sql, connectionId))?.id
  }
}

export const PRESET_LIST = Object.entries(PRESETS).map(([id, p]) => ({ id: id as PresetId, label: p.label, kinds: p.kinds as readonly ProxyKind[] }))
