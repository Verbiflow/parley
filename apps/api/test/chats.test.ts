import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { testServer } from "./support.ts"
import { nameChats, setIgnored, mergeChats } from "../src/sessions/chats.ts"
import { setHistorySync } from "../src/sessions/store.ts"

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

  // Ignore the group first: the new link must keep that.
  await setIgnored(sql, oldId, ["club"], true)
  const res = await fetch(`${base}/app/connections/${oldId}/relink`, { method: "POST", redirect: "manual", headers: { cookie } })
  assert.equal(res.status, 302)
  const newId = res.headers.get("location")!.match(/\/link\/([0-9a-f-]{36})/)![1]!
  assert.notEqual(newId, oldId)
  const all = await sessions.list(accountId)
  assert.equal(all.find((c) => c.id === oldId)?.status, "logged_out")
  // The ignore carried over by id: when the group turns up on the new link, it's already ignored.
  fake.simulator.completeLink(newId)
  await waitUntil(() => sessions.status(accountId, newId), (st) => st.status === "connected")
  fake.simulator.announceChats(newId, [{ id: "club", name: "Club", kind: "group" }, { id: "other", name: "Other", kind: "group" }])
  const fresh = await waitUntil(() => sessions.chats(accountId, newId), (c) => c.length === 2)
  assert.equal(fresh.find((c) => c.id === "club")!.synced, false)
  assert.equal(fresh.find((c) => c.id === "other")!.synced, true)
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

test("a call is activity: it moves the chat up, and the list says which way the latest call went", async () => {
  const { accountId, connectionId } = await linked("caller@parley.test")
  fake.simulator.announceChats(connectionId, [
    { id: "old", name: "Old friend", kind: "direct", lastMessageAt: "2026-10-01T10:00:00.000Z" },
    { id: "new", name: "Chatty", kind: "direct", lastMessageAt: "2026-11-01T10:00:00.000Z" },
  ])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 2)
  // A missed call from the old friend, later than anything in the other chat.
  fake.simulator.announceChats(connectionId, [{ id: "old", name: null, kind: "direct", lastCall: { at: "2026-11-02T09:00:00.000Z", kind: "missed" } }])
  const chats = await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c[0]?.id === "old")
  assert.equal(chats[0]!.lastCallKind, "missed")
  assert.equal(chats[0]!.lastMessageAt, "2026-11-02T09:00:00.000Z")
  assert.equal(chats[0]!.name, "Old friend")
  // An older call doesn't overwrite the latest one.
  fake.simulator.announceChats(connectionId, [{ id: "old", name: null, kind: "direct", lastCall: { at: "2026-10-15T09:00:00.000Z", kind: "outgoing" } }])
  fake.simulator.announceChats(connectionId, [{ id: "new", name: null, kind: "direct", lastCall: { at: "2026-10-20T09:00:00.000Z", kind: "outgoing" } }])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.find((x) => x.id === "new")?.lastCallKind === "outgoing")
  const after = await sessions.chats(accountId, connectionId)
  assert.equal(after.find((c) => c.id === "old")!.lastCallKind, "missed")

  const html = await (await fetch(`${base}/app/connections/${connectionId}/chats`, { headers: { cookie: await browser("caller@parley.test") } })).text()
  assert.match(html, /class="s miss">Missed call</)
  assert.match(html, /contact · called /)
})

test("one person, two ids: the private-id row folds into the phone-number row (call, name, messages), no duplicate", async () => {
  const { accountId, connectionId } = await linked("merger@parley.test")
  fake.simulator.announceChats(connectionId, [
    { id: "123@lid", name: "Akshaya Direct", kind: "direct", lastCall: { at: "2026-11-03T10:00:00.000Z", kind: "outgoing" } },
    { id: "16024132657@s.whatsapp.net", name: null, kind: "direct", lastMessageAt: "2026-11-03T09:00:00.000Z" },
  ])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 2)
  fake.simulator.deliver(connectionId, { threadId: "123@lid", from: "123@lid", text: "under the private id" })
  fake.simulator.deliver(connectionId, { threadId: "16024132657@s.whatsapp.net", from: "x", text: "under the number" })
  await waitUntil(() => sessions.messages(accountId, connectionId, "16024132657@s.whatsapp.net", { limit: 10 }), (r) => r.messages.length === 1)
  await waitUntil(() => sessions.messages(accountId, connectionId, "123@lid", { limit: 10 }), (r) => r.messages.length === 1)

  await mergeChats(sql, connectionId, [{ from: "123@lid", to: "16024132657@s.whatsapp.net" }])
  const chats = await sessions.chats(accountId, connectionId)
  assert.deepEqual(chats.map((c) => c.id), ["16024132657@s.whatsapp.net"])
  assert.equal(chats[0]!.name, "Akshaya Direct")
  assert.equal(chats[0]!.lastCallKind, "outgoing")
  assert.equal(chats[0]!.lastMessageAt! >= "2026-11-03T10:00:00.000Z", true)
  const read = await sessions.messages(accountId, connectionId, "16024132657@s.whatsapp.net", { limit: 10 })
  assert.deepEqual(read.messages.map((m) => m.text).sort(), ["under the number", "under the private id"])
  // Merging again (or a pair with nothing behind it) is a no-op.
  await mergeChats(sql, connectionId, [{ from: "123@lid", to: "16024132657@s.whatsapp.net" }, { from: "nobody@lid", to: "1@s.whatsapp.net" }])
  assert.equal((await sessions.chats(accountId, connectionId)).length, 1)
})

test("while a fresh link syncs, the chat page shows progress; once settled it doesn't", async () => {
  const { connectionId } = await linked("syncer@parley.test")
  fake.simulator.announceChats(connectionId, [{ id: "g", name: "G", kind: "group" }])
  const cookie = await browser("syncer@parley.test")
  const page = async () => (await fetch(`${base}/app/connections/${connectionId}/chats`, { headers: { cookie } })).text()
  await waitUntil(page, (h) => h.includes('data-id="g"'))
  await setHistorySync(sql, connectionId, 42, false)
  assert.match(await page(), /Syncing your chats from \w+ · 42%/)
  await setHistorySync(sql, connectionId, 10, false) // progress never goes backwards
  assert.match(await page(), /· 42%/)
  await setHistorySync(sql, connectionId, 100, true)
  assert.doesNotMatch(await page(), /Syncing your chats/)
})

test("an ignore made under a private id carries to the number once they're matched", async () => {
  const { accountId, connectionId } = await linked("lidignore@parley.test")
  fake.simulator.announceChats(connectionId, [{ id: "9@lid", name: "Sam", kind: "direct", lastMessageAt: "2026-11-03T09:00:00.000Z" }])
  await waitUntil(() => sessions.chats(accountId, connectionId), (c) => c.length === 1)
  await setIgnored(sql, connectionId, ["9@lid"], true)
  await mergeChats(sql, connectionId, [{ from: "9@lid", to: "6599990000@s.whatsapp.net" }])
  const [row] = await sessions.chats(accountId, connectionId)
  assert.equal(row!.id, "6599990000@s.whatsapp.net")
  assert.equal(row!.synced, false)
  // And a message to that number later isn't kept.
  fake.simulator.deliver(connectionId, { threadId: "6599990000@s.whatsapp.net", from: "x", text: "nope" })
  await new Promise((r) => setTimeout(r, 100))
  const [{ n }] = await sql<{ n: string }>(`select count(*)::text as n from parley.message where connection_id = $1`, [connectionId])
  assert.equal(n, "0")
})

test("a history batch is stored in one go: chats get their latest activity, ignored chats keep nothing", async () => {
  const { accountId, connectionId } = await linked("bulk@parley.test")
  await setIgnored(sql, connectionId, ["muted@s.whatsapp.net"], true)
  const { touchChats, saveMessages } = await import("../src/sessions/chats.ts")
  const msgs = Array.from({ length: 600 }, (_, i) => ({
    id: `m${i}`, threadId: i % 3 === 0 ? "muted@s.whatsapp.net" : `p${i % 3}@s.whatsapp.net`, from: "x", fromMe: false, text: `hi ${i}`,
    at: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
  }))
  await touchChats(sql, connectionId, msgs.map((m) => ({ id: m.threadId, at: m.at })))
  await saveMessages(sql, connectionId, msgs)
  const chats = new Map((await sessions.chats(accountId, connectionId)).map((c) => [c.id, c]))
  assert.equal(chats.size, 3)
  assert.equal(chats.get("muted@s.whatsapp.net")!.synced, false)
  assert.equal(chats.get("p2@s.whatsapp.net")!.lastMessageAt, msgs[599 - ((599 - 2) % 3)]!.at)
  const [{ n }] = await sql<{ n: string }>(`select count(*)::text as n from parley.message where connection_id = $1`, [connectionId])
  assert.equal(n, "400")
})
