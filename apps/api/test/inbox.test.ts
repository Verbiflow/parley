import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { testServer } from "./support.ts"

const wa = makeFakeChannel("fake-wa")
const tg = makeFakeChannel("fake-tg")
const { ctx, sql } = await testServer([wa.channel, tg.channel])
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

test("read_inbox spans every connected channel's synced chats, filters by channel/chat, and skips disconnected ones", async () => {
  const account = await store.upsertAccount(sql, { subject: "local:inbox@parley.test", email: "inbox@parley.test", name: "In", signedInWith: "local" })
  const link = async (fake: typeof wa, channel: string) => {
    const { connectionId } = await sessions.connect(account.id, channel)
    await waitUntil(() => sessions.status(account.id, connectionId), (s) => Boolean(s.link))
    fake.simulator.completeLink(connectionId)
    await waitUntil(() => sessions.status(account.id, connectionId), (s) => s.status === "connected")
    return connectionId
  }
  const waId = await link(wa, "fake-wa")
  const tgId = await link(tg, "fake-tg")
  wa.simulator.announceChats(waId, [{ id: "ana", name: "Ana", kind: "direct" }, { id: "secret", name: "Secret", kind: "direct" }])
  tg.simulator.announceChats(tgId, [{ id: "devs", name: "Devs", kind: "group" }])
  await waitUntil(() => sessions.inboxChats(account.id), () => true)
  await waitUntil(() => sessions.chats(account.id, tgId), (c) => c.length === 1)
  await sessions.chooseChats(account.id, waId, ["ana"])
  await sessions.chooseChats(account.id, tgId, ["devs"])

  wa.simulator.deliver(waId, { threadId: "ana", from: "ana", text: "wa 1" })
  wa.simulator.deliver(waId, { threadId: "secret", from: "x", text: "not synced" })
  await new Promise((r) => setTimeout(r, 5))
  tg.simulator.deliver(tgId, { threadId: "devs", from: "dev", text: "tg 1" })

  const all = await waitUntil(() => sessions.inbox(account.id, { limit: 10 }), (m) => m.length === 2)
  assert.deepEqual(all.map((m) => [m.channel, m.chatName, m.text]), [["fake-tg", "Devs", "tg 1"], ["fake-wa", "Ana", "wa 1"]])

  assert.deepEqual((await sessions.inbox(account.id, { limit: 10, channel: "fake-wa" })).map((m) => m.text), ["wa 1"])
  assert.deepEqual((await sessions.inbox(account.id, { limit: 10, chatId: "devs" })).map((m) => m.text), ["tg 1"])
  assert.deepEqual((await sessions.inboxChats(account.id)).map((c) => c.id).sort(), ["ana", "devs"])

  // Disconnecting a channel drops it from the inbox.
  await sessions.logout(account.id, tgId)
  assert.deepEqual((await sessions.inbox(account.id, { limit: 10 })).map((m) => m.channel), ["fake-wa"])

  // Another account's inbox is empty, and it can't scope to someone else's connection.
  const other = await store.upsertAccount(sql, { subject: "local:other-inbox@parley.test", email: "other-inbox@parley.test", name: "O", signedInWith: "local" })
  assert.deepEqual(await sessions.inbox(other.id, { limit: 10 }), [])
  await assert.rejects(sessions.inbox(other.id, { limit: 10, connectionId: waId }), /not your connection/)
})
