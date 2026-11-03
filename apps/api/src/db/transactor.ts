import pg from "pg"
import type { Sql } from "@parley/auth"

const STATEMENT_TIMEOUT_MS = 10_000

/**
 * Transactions on their own connections. The request database is one shared connection, so a transaction there would
 * capture whatever else runs concurrently; work that holds row locks (reserving a send slot, claiming due messages,
 * allocating an exit) runs here instead.
 */
export class Transactor {
  readonly #pool: pg.Pool

  constructor(connectionString: string) {
    this.#pool = new pg.Pool({ connectionString, max: 5, statement_timeout: STATEMENT_TIMEOUT_MS, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 5_000, allowExitOnIdle: true })
    this.#pool.on("error", () => {})
  }

  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect()
    const sql: Sql = async (text, values = []) => (await client.query(text, [...values])).rows
    try {
      await client.query("begin")
      const result = await work(sql)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.#pool.end().catch(() => {})
  }
}
