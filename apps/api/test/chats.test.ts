import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { testServer } from "./support.ts"

const fake = makeFakeChannel("fake")
const { ctx, sql, base } = await testServer([fake.channel])
const sessions = ctx.sessions

async function waitUntil<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function linked(email: string) {
  const account = await store.upsertAccount(sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })
  const { connectionId } = await sessions.connect(account.id, "fake")
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
  return { accountId: account.id, connectionId }
}

test("only chosen chats sync: held history backfills them, the rest stay invisible, unticking wipes", async () => {
  const { accountId, connectionId } = await linked("chats@parley.test")

  // First link: the channel reports chats and recent history before the person has chosen anything.
  fake.simulator.announceChats(connectionId, [
    { id: "alice", name: "Alice", kind: "direct", lastMessageAt: "2026-11-01T10:00:00.000Z" },
    { id: "family", name: "Family", kind: "group", lastMessageAt: "2026-11-02T10:00:00.000Z" },
    { id: "bob", name: null, kind: "direct" },
  ])
  const all = await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 3)
  // Most recent first; a chat with no known activity sorts last.
  assert.deepEqual(all.map((c) => c.id), ["family", "alice", "bob"])
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "alice", text: "hey from history" })
  fake.simulator.deliver(connectionId, { threadId: "bob", from: "bob", text: "bob's secret" })
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "me", text: "my reply", fromMe: true })
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c[0]?.id !== "family")
  assert.equal(all.find((c) => c.id === "family")!.kind, "group")
  assert.ok(all.every((c) => !c.synced))

  // Nothing is stored or visible before choosing.
  const [{ n }] = await sql<{ n: string }>(`select count(*)::text as n from parley.message where connection_id = $1`, [connectionId])
  assert.equal(n, "0")
  assert.deepEqual(await sessions.chats(accountId, connectionId, { syncedOnly: true }), [])
  await assert.rejects(sessions.messages(accountId, connectionId, "alice", { limit: 10 }), /no such synced chat/)

  // Choose Alice: her held history is backfilled (both sides), Bob's never touches the DB.
  await sessions.chooseChats(accountId, connectionId, ["alice"])
  const read = await sessions.messages(accountId, connectionId, "alice", { limit: 10 })
  assert.deepEqual(read.messages.map((m) => [m.text, m.fromMe]), [["hey from history", false], ["my reply", true]])
  assert.deepEqual((await sessions.chats(accountId, connectionId, { syncedOnly: true })).map((c) => c.id), ["alice"])
  await assert.rejects(sessions.messages(accountId, connectionId, "bob", { limit: 10 }), /no such synced chat/)

  // New messages: synced chat stores them, unsynced chat doesn't.
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "alice", text: "live one" })
  fake.simulator.deliver(connectionId, { threadId: "bob", from: "bob", text: "still private" })
  await waitUntil(() => sessions.messages(accountId, connectionId, "alice", { limit: 10 }), (r) => r.messages.length === 3)
  const [{ total }] = await sql<{ total: string }>(`select count(*)::text as total from parley.message where connection_id = $1`, [connectionId])
  assert.equal(total, "3")

  // A later name for Bob fills in without blanking anything.
  fake.simulator.announceChats(connectionId, [{ id: "bob", name: "Bob", kind: "direct" }, { id: "alice", name: null, kind: "direct" }])
  const named = await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.find((x) => x.id === "bob")?.name === "Bob")
  assert.equal(named.find((c) => c.id === "alice")!.name, "Alice")

  // Untick Alice, tick Bob: Alice's messages are deleted; Bob had no held history left (it's dropped after the first choice).
  await sessions.chooseChats(accountId, connectionId, ["bob"])
  const [{ left }] = await sql<{ left: string }>(`select count(*)::text as left from parley.message where connection_id = $1`, [connectionId])
  assert.equal(left, "0")
  await assert.rejects(sessions.messages(accountId, connectionId, "alice", { limit: 10 }), /no such synced chat/)
})

test("another account can't read or choose chats on a connection", async () => {
  const { connectionId } = await linked("owner@parley.test")
  const other = await store.upsertAccount(sql, { subject: "local:intruder@parley.test", email: "intruder@parley.test", name: "I", signedInWith: "local" })
  await assert.rejects(sessions.chats(other.id, connectionId), /not your connection/)
  await assert.rejects(sessions.chooseChats(other.id, connectionId, ["x"]), /not your connection/)
})

async function browser(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })
  return res.headers.get("set-cookie")!.split(";")[0]!
}

test("the chat picker: sign-in required (and resumes after), owner only, saves the ticked set", async () => {
  const { accountId, connectionId } = await linked("picker@parley.test")
  fake.simulator.announceChats(connectionId, [
    { id: "carol", name: "Carol <script>", kind: "direct" },
    { id: "team", name: "Team", kind: "group" },
  ])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 2)
  const path = `/app/connections/${connectionId}/chats`

  // Signed out: bounced to sign-in, and sent back to the picker afterwards.
  const out = await fetch(`${base}${path}`, { redirect: "manual" })
  assert.equal(out.headers.get("location"), "/")
  const next = out.headers.get("set-cookie")!.split(";")[0]!
  const signIn = await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", headers: { cookie: next }, body: new URLSearchParams({ email: "picker@parley.test" }) })
  assert.equal(signIn.headers.get("location"), path)

  const cookie = await browser("picker@parley.test")
  const html = await (await fetch(`${base}${path}`, { headers: { cookie } })).text()
  assert.match(html, /Choose what to sync/)
  assert.match(html, /Carol &lt;script&gt;/)
  assert.doesNotMatch(html, /Carol <script>/)

  // Someone else's account gets a 404, and can't save.
  const intruder = await browser("mallory2@parley.test")
  assert.equal((await fetch(`${base}${path}`, { headers: { cookie: intruder } })).status, 404)
  assert.equal((await fetch(`${base}${path}`, { method: "POST", redirect: "manual", headers: { cookie: intruder }, body: new URLSearchParams({ chat: "team" }) })).status, 404)

  const saved = await fetch(`${base}${path}`, { method: "POST", redirect: "manual", headers: { cookie }, body: new URLSearchParams([["chat", "team"]]) })
  assert.equal(saved.headers.get("location"), `${path}?saved=1`)
  assert.deepEqual((await sessions.chats(accountId, connectionId, { syncedOnly: true })).map((c) => c.id), ["team"])
  assert.match(await (await fetch(`${base}${path}?saved=1`, { headers: { cookie } })).text(), /value="team" checked/)
})
