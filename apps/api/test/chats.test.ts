import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { testServer } from "./support.ts"
import { nameChats, setIgnored } from "../src/sessions/chats.ts"

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

test("chats sync by default; ignoring one deletes what was stored and keeps new messages out; un-ignoring resumes", async () => {
  const { accountId, connectionId } = await linked("chats@parley.test")

  fake.simulator.announceChats(connectionId, [
    { id: "alice", name: "Alice", kind: "direct", lastMessageAt: "2026-11-01T10:00:00.000Z" },
    { id: "family", name: "Family", kind: "group", lastMessageAt: "2026-11-02T10:00:00.000Z" },
    { id: "bob", name: null, kind: "direct" },
  ])
  const all = await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 3)
  // Most recent first; a chat with no known activity sorts last. Everything syncs until ignored.
  assert.deepEqual(all.map((c) => c.id), ["family", "alice", "bob"])
  assert.ok(all.every((c) => c.synced))

  fake.simulator.deliver(connectionId, { threadId: "alice", from: "alice", text: "hey" })
  fake.simulator.deliver(connectionId, { threadId: "bob", from: "bob", text: "bob's secret" })
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "me", text: "my reply", fromMe: true })
  await waitUntil(() => sessions.messages(accountId, connectionId, "alice", { limit: 10 }), (r) => r.messages.length === 2)
  await waitUntil(() => sessions.messages(accountId, connectionId, "bob", { limit: 10 }), (r) => r.messages.length === 1)

  // Ignore Bob: his stored message is deleted, agents can't read him, and new messages from him aren't kept.
  await setIgnored(sql, connectionId, ["bob"], true)
  await assert.rejects(sessions.messages(accountId, connectionId, "bob", { limit: 10 }), /no such synced chat/)
  assert.deepEqual((await sessions.chats(accountId, connectionId, { syncedOnly: true })).map((c) => c.id).sort(), ["alice", "family"])
  fake.simulator.deliver(connectionId, { threadId: "bob", from: "bob", text: "still private" })
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "alice", text: "live one" })
  await waitUntil(() => sessions.messages(accountId, connectionId, "alice", { limit: 10 }), (r) => r.messages.length === 3)
  const [{ bobs }] = await sql<{ bobs: string }>(`select count(*)::text as bobs from parley.message where connection_id = $1 and chat_id = 'bob'`, [connectionId])
  assert.equal(bobs, "0")

  // A chat that turns up later syncs too (ignoring is per chat, not a snapshot of the list).
  fake.simulator.deliver(connectionId, { threadId: "dana", from: "dana", text: "new here" })
  await waitUntil(() => sessions.messages(accountId, connectionId, "dana", { limit: 10 }).catch(() => ({ messages: [] })), (r) => r.messages.length === 1)

  // A later name for Bob fills in without blanking anything.
  fake.simulator.announceChats(connectionId, [{ id: "bob", name: "Bob", kind: "direct" }, { id: "alice", name: null, kind: "direct" }])
  const named = await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.find((x) => x.id === "bob")?.name === "Bob")
  assert.equal(named.find((c) => c.id === "alice")!.name, "Alice")

  // Un-ignore Bob: new messages are kept again.
  await setIgnored(sql, connectionId, ["bob"], false)
  fake.simulator.deliver(connectionId, { threadId: "bob", from: "bob", text: "back again" })
  const back = await waitUntil(() => sessions.messages(accountId, connectionId, "bob", { limit: 10 }), (r) => r.messages.length === 1)
  assert.equal(back.messages[0]!.text, "back again")
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
  assert.match(html, /Your chats/)
  assert.match(html, /Carol &lt;script&gt;/)
  assert.doesNotMatch(html, /Carol <script>/)

  // Someone else's account gets a 404, and can't ignore anything.
  const intruder = await browser("mallory2@parley.test")
  const ignore = (who: string, chats: string[], ignored = true) => fetch(`${base}${path}/ignore`, { method: "POST", headers: { cookie: who, "content-type": "application/json" }, body: JSON.stringify({ chats, ignored }) })
  assert.equal((await fetch(`${base}${path}`, { headers: { cookie: intruder } })).status, 404)
  assert.equal((await ignore(intruder, ["team"])).status, 404)
  assert.ok((await sessions.chats(accountId, connectionId)).every((c) => c.synced))

  // Ignoring one chat leaves the rest syncing, and the page shows it as ignored.
  assert.equal((await ignore(cookie, ["team"])).status, 200)
  assert.deepEqual((await sessions.chats(accountId, connectionId, { syncedOnly: true })).map((c) => c.id), ["carol"])
  assert.match(await (await fetch(`${base}${path}`, { headers: { cookie } })).text(), /class="chat off" data-id="team"/)
  assert.equal((await ignore(cookie, ["team"], false)).status, 200)
  assert.equal((await sessions.chats(accountId, connectionId, { syncedOnly: true })).length, 2)
})

test("relink signs the old link out and opens a fresh QR for the same account; nobody else can relink it", async () => {
  const { accountId, connectionId: oldId } = await linked("relinker@parley.test")
  const cookie = await browser("relinker@parley.test")
  const intruder = await browser("not-relinker@parley.test")
  assert.equal((await fetch(`${base}/app/connections/${oldId}/relink`, { method: "POST", redirect: "manual", headers: { cookie: intruder } })).status, 404)

  // An account with no people yet (groups only) is offered the relink.
  fake.simulator.announceChats(oldId, [{ id: "club", name: "Club", kind: "group" }])
  await waitUntil(() => sessions.chats(accountId, oldId), (c) => c.length === 1)
  assert.match(await (await fetch(`${base}/app/connections/${oldId}/chats`, { headers: { cookie } })).text(), new RegExp(`action="/app/connections/${oldId}/relink"`))

  const res = await fetch(`${base}/app/connections/${oldId}/relink`, { method: "POST", redirect: "manual", headers: { cookie } })
  assert.equal(res.status, 302)
  const newId = res.headers.get("location")!.match(/\/link\/([0-9a-f-]{36})/)![1]!
  assert.notEqual(newId, oldId)
  const all = await sessions.list(accountId)
  assert.equal(all.find((c) => c.id === oldId)?.status, "logged_out")
  assert.ok(all.find((c) => c.id === newId))
})

test("address-book names fill in chats already listed, never add new ones, and leave groups alone", async () => {
  const { accountId, connectionId } = await linked("namer@parley.test")
  fake.simulator.announceChats(connectionId, [{ id: "p1", name: null, kind: "direct" }, { id: "g1", name: "Club", kind: "group" }])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 2)
  await nameChats(sql, connectionId, [{ id: "p1", name: "Priya" }, { id: "g1", name: "Renamed" }, { id: "stranger", name: "Not a chat" }])
  const byId = new Map((await sessions.chats(accountId, connectionId)).map((c) => [c.id, c]))
  assert.equal(byId.size, 2)
  assert.equal(byId.get("p1")?.name, "Priya")
  assert.equal(byId.get("g1")?.name, "Club")
})
