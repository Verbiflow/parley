import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { Sessions } from "../src/sessions/actor.ts"
import { testServer } from "./support.ts"

const fake = makeFakeChannel("fake")
const { ctx, sql } = await testServer([fake.channel])
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

test("connect → link → complete → connected → send; creds are sealed and the connection reconnects from the DB", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:ses@parley.test", email: "ses@parley.test", name: "Ses", signedInWith: "local" })

  // connect starts a fresh link
  const { connectionId } = await sessions.connect(account.id, "fake")
  const linking = await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
  assert.equal(linking.status, "linking")
  assert.equal(linking.link!.method, "qr")

  // the user completes the link
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")

  // send works on the live connection
  const sent = await sessions.send(account.id, connectionId, "+15550100", "hi")
  assert.ok(sent.id)
  assert.equal(fake.simulator.sent(connectionId).length, 1)

  // the sealed creds were persisted (channel-creds for this connection)
  const [{ n }] = await sql<{ n: string }>(
    `select count(*)::text as n from secret.record where kind = 'channel-creds' and purpose = 'fake' and name = $1`,
    [connectionId]
  )
  assert.equal(n, "1")

  // a brand-new pool (as after a restart) re-opens the connection from the sealed creds and can send
  const afterRestart = new Sessions({ sql, channels: [fake.channel], config: ctx.config })
  const reopened = await afterRestart.hydrateAll()
  assert.ok(reopened >= 1)
  const again = await afterRestart.send(account.id, connectionId, "+15550100", "back online")
  assert.ok(again.id)

  // logout unlinks and forgets the creds
  await afterRestart.logout(account.id, connectionId)
  const [{ n: after }] = await sql<{ n: string }>(
    `select count(*)::text as n from secret.record where kind = 'channel-creds' and name = $1`,
    [connectionId]
  )
  assert.equal(after, "0")
  assert.equal((await sessions.status(account.id, connectionId)).status, "logged_out")
})

test("connect is refused for an unknown channel", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:ses2@parley.test", email: "ses2@parley.test", name: "S2", signedInWith: "local" })
  await assert.rejects(sessions.connect(account.id, "telegram"), /no channel/)
})
