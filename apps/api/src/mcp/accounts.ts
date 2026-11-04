import { parsePhoneNumberFromString } from "libphonenumber-js"
import type { AppContext } from "../context.ts"
import type { Connection } from "../sessions/store.ts"

/**
 * Which of the caller's connections a tool call means. With several accounts on one channel (two WhatsApp numbers,
 * say), agents name one by its connection id or simply by its phone number; when they name none, the call works out
 * the only one that fits, or says which ones it could be.
 */

/** "+65 9136 3557" for a WhatsApp handle, the handle itself for other channels, null before linking. */
export function accountLabel(c: Pick<Connection, "handle">): string | null {
  if (!c.handle) return null
  if (!c.handle.includes("@")) return c.handle
  const d = c.handle.split("@")[0]!.split(":")[0]!.replace(/\D/g, "")
  return d ? (parsePhoneNumberFromString(`+${d}`)?.formatInternational() ?? `+${d}`) : c.handle
}

const digits = (s: string) => s.replace(/\D/g, "")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The caller's connections that agents can use (linked or linking — not the ones signed out). */
async function usable(ctx: AppContext, userId: string): Promise<Connection[]> {
  return (await ctx.sessions.list(userId)).filter((c) => c.status !== "logged_out" && c.status !== "error")
}

export class AccountError extends Error {}

const choices = (cs: Connection[]) => cs.map((c) => `${accountLabel(c) ?? "unlinked"} (${c.channel}, connection_id ${c.id})`).join("; ")

/**
 * Resolve what an agent passed as `connection_id` — a connection id, or the account's number/handle — to one of the
 * caller's connections. Returns undefined for an omitted ref (the caller decides what "none" means).
 */
export async function findConnection(ctx: AppContext, userId: string, ref: string | undefined, channel?: string): Promise<Connection | undefined> {
  const ref_ = ref?.trim()
  if (!ref_) return undefined
  const all = await ctx.sessions.list(userId)
  if (UUID.test(ref_)) {
    const byId = all.find((c) => c.id.toLowerCase() === ref_.toLowerCase())
    if (byId) return byId
    throw new AccountError("no such connection (call list_connections)")
  }
  const live = (await usable(ctx, userId)).filter((c) => !channel || c.channel === channel)
  const want = digits(ref_)
  const matches = live.filter((c) => {
    const label = accountLabel(c)
    if (!label) return false
    if (label === ref_ || c.handle === ref_) return true
    return want.length >= 6 && digits(label) === want
  })
  if (matches.length === 1) return matches[0]
  if (!matches.length) throw new AccountError(`no connected account "${ref_}". Yours: ${choices(live) || "none (call connect)"}`)
  throw new AccountError(`"${ref_}" matches several connections: ${choices(matches)}. Pass a connection_id.`)
}

/**
 * The one connection a send/react/fetch goes through. An explicit ref wins. Otherwise: the connections that hold
 * `hint` (a chat, or a message in a chat) when given, else every live one — and it must come down to exactly one.
 */
export async function pickConnection(
  ctx: AppContext, userId: string, ref: string | undefined, hint: { chatId?: string; messageId?: string } = {}
): Promise<Connection> {
  const named = await findConnection(ctx, userId, ref)
  if (named) return named
  const live = (await usable(ctx, userId)).filter((c) => c.status === "connected")
  if (live.length === 1) return live[0]!
  if (!live.length) throw new AccountError("no connected account. Ask the account holder to link one (call connect)")
  if (hint.chatId) {
    // A phone number names the same chat as its WhatsApp id.
    const ids = [hint.chatId, ...(/^\+?[\d\s().-]{6,}$/.test(hint.chatId) ? [`${digits(hint.chatId)}@s.whatsapp.net`] : [])]
    const rows = await ctx.sql<{ connection_id: string }>(
      hint.messageId
        ? `select distinct connection_id from parley.message where connection_id = any($1::uuid[]) and chat_id = any($2::text[]) and id = $3`
        : `select connection_id from parley.chat where connection_id = any($1::uuid[]) and id = any($2::text[]) and synced`,
      hint.messageId ? [live.map((c) => c.id), ids, hint.messageId] : [live.map((c) => c.id), ids]
    )
    const holders = live.filter((c) => rows.some((r) => r.connection_id === c.id))
    if (holders.length === 1) return holders[0]!
    if (holders.length > 1) throw new AccountError(`that chat is on several of your accounts: ${choices(holders)}. Pass connection_id (an id or the number) to pick one.`)
  }
  throw new AccountError(`you have several connected accounts: ${choices(live)}. Pass connection_id (an id or the number) to pick one.`)
}
