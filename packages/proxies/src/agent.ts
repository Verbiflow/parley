import type { Agent } from "node:https"
import { HttpsProxyAgent } from "https-proxy-agent"
import { SocksProxyAgent } from "socks-proxy-agent"
import { parseProxyUrl } from "./index.ts"

/**
 * The Node agent a socket (a WebSocket, an HTTPS fetch) connects through to leave from this exit. Its own entry so
 * only the process that opens channel sockets loads the agent libraries; the edge bundle imports `@parley/proxies`
 * for templates and URLs alone.
 */
export function proxyAgent(url: string): Agent {
  const { protocol } = parseProxyUrl(url)
  // Both tunnel TLS; they're typed as plain http agents, which is what socket libraries' `https.Agent` slots accept.
  const agent = protocol === "socks5" ? new SocksProxyAgent(url.replace(/^socks5:/, "socks5h:")) : new HttpsProxyAgent(url)
  return agent as unknown as Agent
}
