import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { hashSecret, newSecret } from "@parley/auth"
import { makeFakeChannel } from "@parley/channels/fake"
import { testServer } from "./support.ts"

// Register two Fake channels in the registry (a QR one and an OAuth one). The point: they surface through the
// existing `list_channels` tool with zero changes to the tool or the MCP layer — the extension seam working.
const qr = makeFakeChannel("whatsapp-fake", { linkMethod: "qr" })
const oauth = makeFakeChannel("linkedin-fake", { linkMethod: "oauth" })
const { base } = await testServer([qr.channel, oauth.channel])

async function token(email: string): Promise<string> {
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:9999/callback"] }),
  })).json() as { client_id: string }
  const verifier = newSecret("parley_dvc")
  const authorize = await fetch(`${base}/oauth/authorize`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "http://127.0.0.1:9999/callback", code_challenge: await hashSecret(verifier), code_challenge_method: "S256", email }),
  })
  const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!
  const tok = await (await fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://127.0.0.1:9999/callback", client_id: reg.client_id, code_verifier: verifier }),
  })).json() as { access_token: string }
  return tok.access_token
}

test("list_channels surfaces every registered channel with its declared capabilities", async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${await token("dave@parley.test")}` } },
  })
  const client = new Client({ name: "test", version: "0" })
  await client.connect(transport)
  try {
    const result = await client.callTool({ name: "list_channels", arguments: {} })
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { channels: Array<{ id: string; capabilities: { linkMethod: string } }> }
    const byId = Object.fromEntries(payload.channels.map((c) => [c.id, c]))
    assert.equal(byId["whatsapp-fake"]?.capabilities.linkMethod, "qr")
    assert.equal(byId["linkedin-fake"]?.capabilities.linkMethod, "oauth")
  } finally {
    await transport.close()
  }
})
