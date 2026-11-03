import { SendFailure, type Channel, type ChannelEvent, type Chat, type ChannelFake, type ChannelSimulator, type Capabilities, type LiveConnection, type OpenOptions, type OutboundContent, type SendOutcome } from "./contract.ts"

/**
 * An in-memory channel for tests: it fills the `Channel` contract exactly, and its simulator drives the outside
 * world (linking, inbound messages, failures). The conformance suite runs against this, and apps wire it into the
 * registry to prove the connect flow end to end without any real account.
 */
type ConnState = {
  emit: (e: ChannelEvent) => void
  linked: boolean
  sent: Array<{ to: string; content: OutboundContent }>
}

export function makeFakeChannel(id = "fake", capabilities?: Partial<Capabilities>): ChannelFake {
  const caps: Capabilities = { linkMethod: "qr", media: false, groups: false, threads: true, presence: false, ...capabilities }
  const conns = new Map<string, ConnState>()
  const failNext = new Set<string>()
  const failSend = new Map<string, SendOutcome>()
  const proxies = new Map<string, string | undefined>()

  const channel: Channel = {
    id,
    capabilities: caps,
    async open({ connectionId, state, proxy, emit }: OpenOptions): Promise<LiveConnection> {
      proxies.set(connectionId, proxy)
      if (failNext.has(connectionId)) {
        failNext.delete(connectionId)
        emit({ type: "closed", reason: "forced failure" })
        throw new Error("open failed")
      }
      const conn: ConnState = { emit, linked: Boolean(state), sent: [] }
      conns.set(connectionId, conn)
      if (state) {
        // Reconnect from saved creds: live immediately, no link step.
        queueMicrotask(() => emit({ type: "open", handle: `fake:${connectionId}` }))
      } else {
        // Fresh link: show the user the link material; `completeLink` finishes it.
        queueMicrotask(() => emit({ type: "link", method: caps.linkMethod, data: `fake-link-${connectionId}` }))
      }
      return {
        async send(to: string, content: OutboundContent) {
          if (!conn.linked) throw new Error("not linked")
          const failure = failSend.get(connectionId)
          if (failure) {
            failSend.delete(connectionId)
            throw new SendFailure(failure, `simulated ${failure}`)
          }
          conn.sent.push({ to, content })
          return { id: `msg-${conn.sent.length}` }
        },
        async logout() {
          conn.linked = false
          conn.emit({ type: "closed", reason: "logged out" })
          conns.delete(connectionId)
        },
        async close() {
          conns.delete(connectionId)
        },
      }
    },
  }

  const simulator: ChannelSimulator = {
    completeLink(connectionId) {
      const conn = conns.get(connectionId)
      if (!conn) throw new Error(`no open connection ${connectionId}`)
      conn.linked = true
      conn.emit({ type: "open", handle: `fake:${connectionId}` })
      conn.emit({ type: "state", state: JSON.stringify({ linked: true, connectionId }) })
    },
    deliver(connectionId, message) {
      const conn = conns.get(connectionId)
      if (!conn) throw new Error(`no open connection ${connectionId}`)
      conn.emit({ type: "message", message: { id: crypto.randomUUID(), at: new Date().toISOString(), ...message } })
    },
    announceChats(connectionId, chats: Chat[]) {
      const conn = conns.get(connectionId)
      if (!conn) throw new Error(`no open connection ${connectionId}`)
      conn.emit({ type: "chats", chats })
    },
    failNextOpen(connectionId) {
      failNext.add(connectionId)
    },
    sent(connectionId) {
      return conns.get(connectionId)?.sent ?? []
    },
    failNextSend(connectionId, outcome) {
      failSend.set(connectionId, outcome)
    },
    proxyOf(connectionId) {
      return proxies.get(connectionId)
    },
  }

  return { channel, simulator }
}
