import type { Sql } from "@parley/auth/db"

/**
 * The account holder's choices for how agents behave in their chats, across every connected account. Both default
 * on. Each is a ceiling: an agent can skip it on a call, never turn it on while it's off here.
 */
export type AgentBehaviour = {
  /** Reading a chat marks it read on the channel too (blue ticks, if the account holder's own setting allows). */
  readReceipts: boolean
  /** Messages show "typing…" ("recording…" before a voice note) for a moment before they go. */
  typing: boolean
}

export const DEFAULT_BEHAVIOUR: AgentBehaviour = { readReceipts: true, typing: true }

export async function agentBehaviour(sql: Sql, accountId: string): Promise<AgentBehaviour> {
  const [r] = await sql<{ read_receipts: boolean; typing: boolean }>(`select read_receipts, typing from parley.account_settings where account_id = $1`, [accountId])
  return r ? { readReceipts: r.read_receipts, typing: r.typing } : { ...DEFAULT_BEHAVIOUR }
}

export async function setAgentBehaviour(sql: Sql, accountId: string, b: AgentBehaviour): Promise<void> {
  await sql(
    `insert into parley.account_settings (account_id, read_receipts, typing) values ($1, $2, $3)
     on conflict (account_id) do update set read_receipts = excluded.read_receipts, typing = excluded.typing, updated_at = now()`,
    [accountId, b.readReceipts, b.typing]
  )
}
