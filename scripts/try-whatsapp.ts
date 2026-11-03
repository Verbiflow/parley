import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { hashSecret, newSecret } from "@parley/auth"

/**
 * Drive the whole agent flow against a running Parley server, the way an MCP client would: sign in over OAuth, call
 * the `connect` tool, print the link URL to open in a browser, poll until WhatsApp is linked, and optionally send a
 * test message.
 *
 *   npm run dev                      # in one terminal (PARLEY_ENV=local, DATABASE_URL set, migrations applied)
 *   EMAIL=you@example.com node scripts/try-whatsapp.ts [+15551234567]
 */
const BASE = process.env.PARLEY_BASE ?? "http://127.0.0.1:8787"
const EMAIL = process.env.EMAIL ?? "you@example.com"
const REDIRECT = "http://127.0.0.1:9999/callback"
const sendTo = process.argv[2]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const textOf = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text)

async function accessToken(): Promise<string> {
  const reg = (await (await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "try-whatsapp", redirect_uris: [REDIRECT] }) })).json()) as { client_id: string }
  const verifier = newSecret("parley_dvc")
  const authorize = await fetch(`${BASE}/oauth/authorize`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: await hashSecret(verifier), code_challenge_method: "S256", email: EMAIL }),
  })
  const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!
  const tok = (await (await fetch(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }) })).json()) as { access_token: string }
  return tok.access_token
}

const token = await accessToken()
const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
const client = new McpClient({ name: "try-whatsapp", version: "0.0.0" })
await client.connect(transport)

console.log("channels:", textOf(await client.callTool({ name: "list_channels", arguments: {} })).channels.map((c: { id: string }) => c.id).join(", "))
const started = textOf(await client.callTool({ name: "connect", arguments: { channel: "whatsapp" } }))
console.log(`\n👉 Open this in a browser and scan it with WhatsApp (Linked devices → Link a device):\n   ${started.link_url}\n`)

process.stdout.write("waiting for you to scan")
for (;;) {
  const status = textOf(await client.callTool({ name: "connection_status", arguments: { connection_id: started.connection_id } }))
  if (status.status === "connected") {
    console.log(`\n✅ connected as ${status.handle}`)
    break
  }
  process.stdout.write(".")
  await sleep(2000)
}

if (sendTo) {
  const sent = textOf(await client.callTool({ name: "send_message", arguments: { connection_id: started.connection_id, to: sendTo, text: "Hello from Parley 👋" } }))
  console.log("sent:", sent)
}
await transport.close()
process.exit(0)
