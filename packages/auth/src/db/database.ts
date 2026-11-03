import { Client } from "pg"

export type Row = Record<string, unknown>
export type Sql = <T extends Row = Row>(text: string, values?: readonly unknown[]) => Promise<T[]>

const CONNECT_TIMEOUT_MS = 5_000
const STATEMENT_TIMEOUT_MS = 10_000

/**
 * The request's one Postgres connection, opened on first use. Lifted from mako-cloud's `db/database.ts`; on plain
 * Node a connection per request (or per worker) is fine, and `transaction` runs work atomically on it.
 */
export class RequestDatabase {
  readonly #connectionString: string
  #client: Promise<Client> | undefined

  constructor(connectionString: string) {
    this.#connectionString = connectionString
  }

  readonly query: Sql = async <T extends Row>(text: string, values: readonly unknown[] = []) =>
    (await (await this.#connect()).query<T>(text, [...values])).rows

  /** Runs `work` in one transaction; nothing else may use the connection meanwhile. */
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.#connect()
    await client.query("begin")
    try {
      const result = await work(this.query)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    }
  }

  async close(): Promise<void> {
    const opening = this.#client
    this.#client = undefined
    const client = await opening?.catch(() => undefined)
    await client?.end().catch(() => {})
  }

  #connect(): Promise<Client> {
    if (this.#client) return this.#client
    const client = new Client({
      connectionString: this.#connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    })
    const opening = client.connect().then(() => client)
    // A dropped or failed connection (DB restart, failover, network blip) must neither crash a long-lived process (an
    // unhandled 'error' event would) nor wedge it on a dead client: forget it, and the next query reconnects.
    const forget = () => {
      if (this.#client === opening) this.#client = undefined
    }
    client.on("error", forget)
    client.on("end", forget)
    opening.catch(forget)
    this.#client = opening
    return opening
  }
}
