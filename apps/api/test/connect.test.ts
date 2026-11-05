import assert from "node:assert/strict"
import { test } from "node:test"
import { makeFakeChannel } from "@parley/channels/fake"
import { getConnection, setStatus } from "../src/sessions/store.ts"
import { testServer, waitUntil } from "./support.ts"

const fake = makeFakeChannel("whatsapp")
const { sql, base } = await testServer([fake.channel])

async function browser(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }) })
  return res.headers.get("set-cookie")!.split(";")[0]!
}

const connect = async (cookie: string) => {
  const res = await fetch(`${base}/app/connect`, { method: "POST", redirect: "manual", headers: { cookie }, body: new URLSearchParams({ timezone: "Europe/London", country: "GB" }) })
  assert.equal(res.status, 302)
  return res.headers.get("location")!.match(/^\/link\/([0-9a-f-]{36})$/)![1]!
}

test("a link that's never scanned isn't an account: Connect picks it up again, even after its QR timed out", async () => {
  const cookie = await browser("abandoner@parley.test")
  const first = await connect(cookie)
  assert.equal(await connect(cookie), first, "a second Connect reopens the same link")

  await setStatus(sql, first, "closed")
  assert.equal(await connect(cookie), first, "one whose QR timed out is reopened too, not left behind")

  const overview = await (await fetch(`${base}/app`, { headers: { cookie } })).text()
  assert.doesNotMatch(overview, /Waiting for the QR scan|waiting for scan/i)
  assert.match(overview, new RegExp(`href="/link/${first}">Finish linking`))

  // Once it's scanned it's an account, and the next Connect starts a new link.
  fake.simulator.completeLink(first, "447700900123")
  const statusOf = async () => (await getConnection(sql, first))?.status
  await waitUntil(statusOf, (s) => s === "connected")
  assert.notEqual(await connect(cookie), first)
})
