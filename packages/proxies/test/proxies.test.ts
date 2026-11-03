import assert from "node:assert/strict"
import { test } from "node:test"
import { HttpsProxyAgent } from "https-proxy-agent"
import { SocksProxyAgent } from "socks-proxy-agent"
import { PRESETS, formatProxyUrl, gatewayEndpoint, newSessionId, parseProxyUrl, proxyAgent, resolveGateway } from "../src/index.ts"

const creds = { username: "acme", password: "s3cret" }
const session = { id: "ab12cd34", country: "us" }

test("each preset writes the session into its credentials the provider's way", () => {
  const cases = [
    ["brightdata", "acme-country-us-session-ab12cd34", "s3cret"],
    ["oxylabs", "customer-acme-cc-US-sessid-ab12cd34-sesstime-1440", "s3cret"],
    ["decodo", "user-acme-country-us-session-ab12cd34-sessionduration-1440", "s3cret"],
    ["iproyal", "acme", "s3cret_country-us_session-ab12cd34_lifetime-1440m"],
  ] as const
  for (const [preset, username, password] of cases) {
    const e = gatewayEndpoint(PRESETS[preset].gateway, creds, session)
    assert.equal(e.username, username, preset)
    assert.equal(e.password, password, preset)
    assert.equal(e.host, PRESETS[preset].gateway.host, preset)
  }
})

test("a custom provider overrides any field, and an incomplete one is refused", () => {
  const g = resolveGateway("oxylabs", { host: "eu.example.net", sessionLifetimeMinutes: 30 })
  assert.equal(gatewayEndpoint(g, creds, session).username, "customer-acme-cc-US-sessid-ab12cd34-sesstime-30")
  assert.equal(g.host, "eu.example.net")
  assert.throws(() => resolveGateway(null, { host: "x" }), /missing protocol/)
})

test("unknown placeholders fail instead of being sent literally", () => {
  const g = resolveGateway(null, { protocol: "http", host: "h", port: 1, usernameTemplate: "{user}", passwordTemplate: "{password}", sessionLifetimeMinutes: 10 })
  assert.throws(() => gatewayEndpoint(g, creds, session), /\{user\}/)
})

test("proxy URLs round-trip credentials that need escaping", () => {
  const url = formatProxyUrl({ protocol: "http", host: "1.2.3.4", port: 8000, username: "u-cc-US", password: "p@ss:w/rd" })
  assert.equal(url, "http://u-cc-US:p%40ss%3Aw%2Frd@1.2.3.4:8000")
  assert.deepEqual(parseProxyUrl(url), { protocol: "http", host: "1.2.3.4", port: 8000, username: "u-cc-US", password: "p@ss:w/rd" })
  assert.equal(parseProxyUrl("socks5h://h:1080").protocol, "socks5")
  assert.throws(() => parseProxyUrl("ftp://h:21"), /unsupported/)
})

test("the agent matches the protocol", () => {
  assert.ok(proxyAgent("http://u:p@1.2.3.4:8000") instanceof HttpsProxyAgent)
  assert.ok(proxyAgent("socks5://u:p@1.2.3.4:1080") instanceof SocksProxyAgent)
})

test("session ids are distinct and narrow", () => {
  const ids = new Set(Array.from({ length: 200 }, newSessionId))
  assert.equal(ids.size, 200)
  for (const id of ids) assert.match(id, /^[a-z0-9]{8}$/)
})
