import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { bound, numberIn, searchWords } from "../src/mcp/server.ts"
import { agentToken, callTool, testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa", { media: true, groups: true })
const { ctx, sql, base } = await testServer([fake.channel])
const sessions = ctx.sessions

const ANA = "6591234567@s.whatsapp.net"
async function linked(email: string) {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake-wa", { timezone: "UTC" })
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  await sessions.settled()
  fake.simulator.announceChats(connectionId, [
    { id: ANA, name: "Ana Lim", kind: "direct" },
    { id: "team@g.us", name: "Design Team", kind: "group" },
    { id: "private@s.whatsapp.net", name: "Private", kind: "direct" },
  ])
  await waitUntil(() => sessions.chats(account.id, connectionId), (c) => c.length === 3)
  await sessions.chooseChats(account.id, connectionId, [ANA, "team@g.us"])
  return { accountId: account.id, connectionId }
}

const ids = (r: any) => r.messages.map((m: any) => m.id)

test("query parsing: words, quoted phrases, numbers, and date bounds", () => {
  assert.deepEqual(searchWords(`  March INVOICE "see you soon" march `), ["March", "INVOICE", "see you soon", "march"])
  assert.deepEqual(searchWords(`""  `), [])
  assert.equal(numberIn("+65 9123-4567"), "6591234567")
  assert.equal(numberIn("65"), undefined)
  assert.equal(numberIn("room 101"), undefined)
  assert.equal(bound("2026-10-31"), "2026-10-31T00:00:00.000Z")
  assert.equal(bound("2026-10-31", true), "2026-11-01T00:00:00.000Z")
  assert.equal(bound("2026-10-31T18:00:00+08:00", true), "2026-10-31T10:00:00.000Z")
})

test("search finds messages by words, dates, sender, media, links and unread, plus matching chats; never in ignored chats, never marks read", async () => {
  const email = "search@parley.test"
  const token = await agentToken(base, email, "Claude")
  const { accountId, connectionId } = await linked(email)
  // History from before linking (never new), then messages that came in since.
  fake.simulator.history(connectionId, [
    { id: "h1", threadId: ANA, from: ANA, text: "Here is the March invoice", at: "2026-10-01T09:00:00.000Z" },
    { id: "h2", threadId: ANA, from: "me", fromMe: true, text: "thanks, paying the invoice today", at: "2026-10-15T09:00:00.000Z" },
    { id: "h3", threadId: "team@g.us", from: "bo@s.whatsapp.net", text: "offsite plan: https://example.com/plan", at: "2026-10-20T09:00:00.000Z" },
    { id: "h5", threadId: "team@g.us", from: "bo@s.whatsapp.net", text: "50% off lunch", at: "2026-11-01T01:00:00.000Z" },
    { id: "h6", threadId: "team@g.us", from: "bo@s.whatsapp.net", text: "500 off lunch", at: "2026-11-01T02:00:00.000Z" },
    { id: "p1", threadId: "private@s.whatsapp.net", from: "x", text: "secret invoice", at: "2026-10-02T09:00:00.000Z" },
  ])
  fake.simulator.deliver(connectionId, { id: "h4", threadId: "team@g.us", from: "bo@s.whatsapp.net", text: "[document: Q3 invoice.pdf]", media: { kind: "document", mimetype: "application/pdf", fileName: "Q3 invoice.pdf", ref: "r1" }, at: "2026-10-31T23:00:00.000Z" })
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  fake.simulator.deliver(connectionId, { id: "n1", threadId: ANA, from: ANA, text: "did the invoice go through?", at: later(1) })
  await waitUntil(() => sessions.inbox(accountId, { limit: 20 }), (ms) => ms.length === 7)

  const search = async (args: Record<string, unknown>) => {
    const r = await callTool(base, token, "search", args)
    assert.equal(r.isError, false, JSON.stringify(r.result))
    return r.result
  }

  // Every word, any order, any case, inside words; newest first. The ignored chat's message is never found.
  const inv = await search({ query: "INVOICE" })
  assert.deepEqual(ids(inv), ["n1", "h4", "h2", "h1"])
  assert.deepEqual(ids(await search({ query: "march invoice" })), ["h1"])
  assert.deepEqual(ids(await search({ query: "inv mar" })), ["h1"])
  assert.equal(inv.messages[1].chat_name, "Design Team")
  assert.equal(inv.messages[1].media.kind, "document")
  // A quoted phrase matches whole; % is just a character.
  assert.deepEqual(ids(await search({ query: `"paying the invoice"` })), ["h2"])
  assert.deepEqual(ids(await search({ query: `"invoice paying"` })), [])
  assert.deepEqual(ids(await search({ query: "50%" })), ["h5"])

  // Chats whose name, or number, matches, like WhatsApp lists them above messages.
  const team = await search({ query: "team" })
  assert.deepEqual(team.chats.map((c: any) => c.chat_id), ["team@g.us"])
  assert.deepEqual((await search({ query: "+65 9123 4567" })).chats.map((c: any) => c.name), ["Ana Lim"])
  assert.deepEqual((await search({ query: "private" })).chats, [])

  // Dates: a date alone covers its whole day.
  assert.deepEqual(ids(await search({ query: "invoice", after: "2026-10-15", before: "2026-10-31" })), ["h4", "h2"])
  assert.deepEqual(ids(await search({ query: "invoice", before: "2026-10-14" })), ["h1"])
  assert.deepEqual(ids(await search({ query: "invoice", after: "2026-10-15T09:00:01Z", before: "2026-11-01" })), ["h4"])

  // Filters, with or without a query.
  assert.deepEqual(ids(await search({ query: "invoice", from_me: true })), ["h2"])
  assert.deepEqual(ids(await search({ query: "invoice", from_me: false, chat_id: ANA })), ["n1", "h1"])
  assert.deepEqual(ids(await search({ media: "document" })), ["h4"])
  assert.deepEqual(ids(await search({ media: "any", query: "invoice" })), ["h4"])
  assert.deepEqual(ids(await search({ media: "image" })), [])
  assert.deepEqual(ids(await search({ links: true })), ["h3"])
  assert.deepEqual(ids(await search({ only_new: true })), ["n1"])

  // Paging back, and the limit.
  const first = await search({ query: "invoice", limit: 2 })
  assert.deepEqual(ids(first), ["n1", "h4"])
  assert.match(first.more, /before: "2026-10-31T23:00:00.000Z"/)
  assert.deepEqual(ids(await search({ query: "invoice", limit: 2, before: first.messages[1].at })), ["h2", "h1"])

  // Searching marks nothing read.
  const chats = (await callTool(base, token, "list_chats")).result.chats
  assert.equal(chats.find((c: any) => c.chat_id === ANA).new.messages, 1)

  // Nothing to search for, or an empty range, is an error; no match says where else to look.
  assert.equal((await callTool(base, token, "search", {})).isError, true)
  assert.equal((await callTool(base, token, "search", { query: "x", after: "2026-11-02", before: "2026-11-01" })).isError, true)
  assert.match((await search({ query: "zebra" })).note, /load_history/)

  // Another account finds nothing of this one's.
  const otherToken = await agentToken(base, "search-other@parley.test", "Claude")
  await linked("search-other@parley.test")
  const other = (await callTool(base, otherToken, "search", { query: "invoice" })).result
  assert.deepEqual(ids(other), [])
})
