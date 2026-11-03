import assert from "node:assert/strict"
import { test } from "node:test"
import { store } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { EXIT_FAILURE_LIMIT } from "../src/sessions/exits.ts"
import { testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("fake-wa")
const { ctx, sql } = await testServer([fake.channel])
const { sessions, exits } = ctx
const T0 = new Date("2026-11-03T15:00:00Z")

const account = (email: string) => store.upsertAccount(sql, { subject: `local:${email}`, email, name: email, signedInWith: "local" })

async function link(accountId: string, country: string) {
  const { connectionId } = await sessions.connect(accountId, "fake-wa", { timezone: "UTC", country })
  await waitUntil(() => sessions.status(accountId, connectionId), (s) => Boolean(s.link))
  fake.simulator.completeLink(connectionId)
  await waitUntil(() => sessions.status(accountId, connectionId), (s) => s.status === "connected")
  return connectionId
}

test("without any provider, connections go direct", async () => {
  const a = await account("direct@parley.test")
  const id = await link(a.id, "US")
  assert.equal(fake.simulator.proxyOf(id), undefined)
})

test("a gateway mints one sticky session per connection, in its country, and the socket uses it from the link on", async () => {
  const a = await account("gateway@parley.test")
  const provider = await exits.addGateway(sql, a.id, { name: "Oxylabs", kind: "residential", preset: "oxylabs", credentials: { username: "acme", password: "pw" }, countries: ["us", "gb"] })
  assert.deepEqual(provider.countries, ["US", "GB"])
  assert.equal(JSON.stringify(provider).includes("pw"), false)

  const gb = await link(a.id, "GB")
  assert.match(fake.simulator.proxyOf(gb)!, /^http:\/\/customer-acme-cc-GB-sessid-[a-z0-9]{8}-sesstime-1440:pw@pr\.oxylabs\.io:7777$/)
  const gb2 = await link(a.id, "GB")
  assert.notEqual(fake.simulator.proxyOf(gb2), fake.simulator.proxyOf(gb))
  await assert.rejects(link(a.id, "DE"), /no proxy exit available in DE/)

  const listed = await exits.exits(sql, a.id)
  assert.equal(listed.length, 2)
  assert.deepEqual(listed.map((e) => e.country), ["GB", "GB"])
  assert.ok(listed.every((e) => e.connectionId))
})

test("an exit that fronted one connection never fronts another on the same channel", async () => {
  const a = await account("static@parley.test")
  await exits.addStatic(sql, a.id, { name: "ISP list", kind: "isp", exits: [{ url: "http://u:p@203.0.113.7:8000", country: "us" }] })
  const first = await link(a.id, "US")
  assert.equal(fake.simulator.proxyOf(first), "http://u:p@203.0.113.7:8000")
  await sql(`update parley.proxy_assignment set released_at = now() where connection_id = $1`, [first])
  await assert.rejects(link(a.id, "US"), /no proxy exit available in US/)
  const [row] = await sql<{ sealed: string }>(`select e.sealed from parley.proxy_exit e join parley.proxy_provider p on p.id = e.provider_id where p.account_id = $1`, [a.id])
  assert.equal(row!.sealed.includes("203.0.113.7"), false)
})

test("the account's own providers come before the hosted pool, within the exit cap", async () => {
  const a = await account("pool@parley.test")
  await exits.addGateway(sql, null, { name: "Hosted mobile", kind: "mobile", preset: "brightdata", credentials: { username: "hosted", password: "x" } })
  await exits.addGateway(sql, a.id, { name: "Own", kind: "residential", preset: "decodo", credentials: { username: "mine", password: "y" }, maxExits: 1 })
  assert.match(fake.simulator.proxyOf(await link(a.id, "US"))!, /gate\.decodo\.com/)
  assert.match(fake.simulator.proxyOf(await link(a.id, "US"))!, /brd\.superproxy\.io/)
  const own = (await exits.providers(sql, a.id))[0]!
  assert.equal(own.exits, 1)
  assert.equal(own.assigned, 1)
  await sql(`delete from parley.proxy_provider where account_id is null`)
})

test("repeated transport failures retire the exit and reconnect through a fresh one", async () => {
  const a = await account("flaky@parley.test")
  await exits.addGateway(sql, a.id, { name: "Decodo", kind: "residential", preset: "decodo", credentials: { username: "u", password: "p" } })
  const id = await link(a.id, "US")
  const before = fake.simulator.proxyOf(id)
  for (let i = 0; i < EXIT_FAILURE_LIMIT; i++) {
    await sessions.enqueue(a.id, id, { to: `+1555070${i}`, text: "x" }, new Date(T0.getTime() + i * 3600_000))
    fake.simulator.failNextSend(id, "transport_error")
    await sessions.dispatchDue(new Date(T0.getTime() + i * 3600_000 + 3_000_000))
  }
  const statuses = await sql<{ status: string }>(`select e.status from parley.proxy_exit e join parley.proxy_provider p on p.id = e.provider_id where p.account_id = $1 order by e.created_at`, [a.id])
  assert.deepEqual(statuses.map((s) => s.status), ["cooling", "active"])
  await waitUntil(async () => fake.simulator.proxyOf(id), (p) => Boolean(p && p !== before))
})
