import assert from "node:assert/strict"
import { after, test } from "node:test"
import { Redis } from "ioredis"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { Sessions } from "../src/sessions/actor.ts"
import { RedisCoordinator } from "../src/sessions/coordinator.ts"
import { freshDatabase, REDIS_URL } from "./support.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitUntil<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error("timed out")
    await sleep(10)
  }
}

// Skip gracefully where Redis isn't available.
let redisOk = true
try {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
  await probe.connect()
  await probe.ping()
  probe.disconnect()
} catch {
  redisOk = false
}

if (!redisOk) {
  test(`cluster routing (skipped: no Redis at ${REDIS_URL})`, { skip: true }, () => {})
} else {
  const fake = makeFakeChannel("fake")
  const { sql, config } = await freshDatabase()
  const coordA = new RedisCoordinator(REDIS_URL)
  const coordB = new RedisCoordinator(REDIS_URL)
  const A = new Sessions({ sql, channels: [fake.channel], config, coordinator: coordA })
  const B = new Sessions({ sql, channels: [fake.channel], config, coordinator: coordB })
  await A.start()
  await B.start()
  after(async () => {
    await coordA.close()
    await coordB.close()
  })

  test("two workers: a send on the non-owner routes to the owner; it survives the owner leaving", async () => {
    const account = await store.upsertAccount(sql, { subject: "local:cl@parley.test", email: "cl@parley.test", name: "Cl", signedInWith: "local" })

    // A connects and owns the connection.
    const { connectionId } = await A.connect(account.id, "fake")
    await waitUntil(() => A.status(account.id, connectionId), (s) => Boolean(s.link))
    fake.simulator.completeLink(connectionId)
    await waitUntil(() => A.status(account.id, connectionId), (s) => s.status === "connected")
    assert.equal(await coordB.ownerOf(connectionId), coordA.workerId)

    // B doesn't hold it — send routes over Redis to A, whose live socket actually sends.
    const viaB = await B.send(account.id, connectionId, "+15550100", "routed via B")
    assert.ok(viaB.id)
    assert.equal(fake.simulator.sent(connectionId).length, 1)

    // B can read status through the owner too.
    assert.equal((await B.status(account.id, connectionId)).status, "connected")

    // The owner "leaves" (crash / lease expiry): B takes over from the sealed creds and keeps serving.
    await coordA.release(connectionId)
    const afterTakeover = await B.send(account.id, connectionId, "+15550100", "after A gone")
    assert.ok(afterTakeover.id)
    assert.equal(await coordA.ownerOf(connectionId), coordB.workerId)
  })
}
