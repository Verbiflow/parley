import assert from "node:assert/strict"
import { after, test } from "node:test"
import { serve, type ServerType } from "@hono/node-server"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { Sessions } from "../src/sessions/actor.ts"
import { rpcApp } from "../src/sessions/rpc-server.ts"
import { RemoteSessions } from "../src/sessions/remote.ts"
import { freshDatabase } from "./support.ts"

// The production split: the sessions service (pool + RPC) on one side, the edge's RemoteSessions on the other,
// talking over HTTP with a shared secret. Same Postgres for both, as in production.
const SECRET = "test-secret-0123456789abcdef0123456789abcdef"
const fake = makeFakeChannel("fake")
const { sql, config } = await freshDatabase()
const pool = new Sessions({ sql, channels: [fake.channel], config })
let server!: ServerType
const port = await new Promise<number>((resolve) => {
  server = serve({ fetch: rpcApp(pool, SECRET).fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve(info.port))
})
const baseUrl = `http://127.0.0.1:${port}`
after(() => new Promise<void>((resolve) => server.close(() => resolve())))

const remote = new RemoteSessions(sql, { fetch, baseUrl, secret: SECRET })

async function waitUntil<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 10))
  }
}

const account = (email: string) => store.upsertAccount(sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })

test("the edge drives a live connection through the sessions service: link, sync, send, read", async () => {
  const { id: accountId } = await account("remote@parley.test")
  const { connectionId, linkMethod } = await remote.connect(accountId, "fake")
  assert.equal(linkMethod, "qr")

  const linking = await waitUntil(() => remote.linkView(connectionId), (v) => Boolean(v.link))
  assert.equal(linking.link?.method, "qr")
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => remote.status(accountId, connectionId), (s) => s.status === "connected")

  fake.simulator.announceChats(connectionId, [{ id: "alice", name: "Alice", kind: "direct" }])
  fake.simulator.deliver(connectionId, { threadId: "alice", from: "alice", text: "hi from alice" })
  await waitUntil(() => remote.chats(accountId, connectionId), (c) => c.length === 1)
  await remote.chooseChats(accountId, connectionId, ["alice"])
  const read = await waitUntil(() => remote.messages(accountId, connectionId, "alice", { limit: 10 }), (r) => r.messages.length === 1)
  assert.equal(read.messages[0]!.text, "hi from alice")

  const sent = await remote.send(accountId, connectionId, "alice", "hello back")
  assert.ok(sent.id)
  assert.deepEqual(fake.simulator.sent(connectionId).map((s) => s.content.text), ["hello back"])

  assert.equal((await remote.list(accountId)).length, 1)
  await remote.logout(accountId, connectionId)
  assert.equal((await remote.status(accountId, connectionId)).status, "logged_out")
})

test("ownership errors come back typed, across the wire and on local reads", async () => {
  const { id: owner } = await account("owner@parley.test")
  const { id: other } = await account("other@parley.test")
  const { connectionId } = await remote.connect(owner, "fake")
  await assert.rejects(remote.send(other, connectionId, "x", "y"), { name: "ConnectError", code: "forbidden" })
  await assert.rejects(remote.chats(other, connectionId), { name: "ConnectError", code: "forbidden" })
  await assert.rejects(remote.connect(owner, "nope"), { name: "ConnectError", code: "unknown_channel" })
})

test("the RPC refuses a wrong secret and anything outside the live ops", async () => {
  const wrong = new RemoteSessions(sql, { fetch, baseUrl, secret: "x".repeat(40) })
  const { id } = await account("intruder@parley.test")
  await assert.rejects(wrong.connect(id, "fake"), /401 unauthorized/)

  const res = await fetch(`${baseUrl}/rpc/hydrateAll`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ args: [] }) })
  assert.equal(res.status, 404)
  const noAuth = await fetch(`${baseUrl}/rpc/status`, { method: "POST", body: JSON.stringify({ args: [] }) })
  assert.equal(noAuth.status, 401)
})
