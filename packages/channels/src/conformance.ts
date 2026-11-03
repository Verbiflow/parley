import type { ChannelEvent, ChannelFake } from "./contract.ts"

/**
 * The channel contract as an executable suite. Every channel ships a Fake; CI runs this against it so a new
 * integration can't merge until it behaves. Real channels are validated by manual/e2e proofs — the contract they
 * must meet is exactly what's checked here.
 */

export type Result = { name: string; status: "passed" | "failed"; detail?: string }

export const CHECKS = [
  "a fresh open emits a link event matching the declared method",
  "completing the link emits open and persists state",
  "send records an outbound and returns an id",
  "an inbound delivery emits a message event",
  "opening with saved state reconnects without a link step",
  "logout closes the connection",
  "a failed open emits a closed event",
] as const

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function collector(): { emit: (e: ChannelEvent) => void; events: ChannelEvent[]; waitFor: (pred: (e: ChannelEvent) => boolean, ms?: number) => Promise<ChannelEvent> } {
  const events: ChannelEvent[] = []
  const waiters: Array<{ pred: (e: ChannelEvent) => boolean; resolve: (e: ChannelEvent) => void; timer: ReturnType<typeof setTimeout> }> = []
  const emit = (e: ChannelEvent) => {
    events.push(e)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(e)) {
        clearTimeout(waiters[i]!.timer)
        waiters[i]!.resolve(e)
        waiters.splice(i, 1)
      }
    }
  }
  const waitFor = (pred: (e: ChannelEvent) => boolean, ms = 1000) => {
    const existing = events.find(pred)
    if (existing) return Promise.resolve(existing)
    return new Promise<ChannelEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a channel event")), ms)
      waiters.push({ pred, resolve, timer })
    })
  }
  return { emit, events, waitFor }
}

export async function runChannelConformance(makeFake: () => ChannelFake): Promise<Result[]> {
  const results: Result[] = []
  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      results.push({ name, status: "passed" })
    } catch (e) {
      results.push({ name, status: "failed", detail: e instanceof Error ? e.message : String(e) })
    }
  }

  await run(CHECKS[0], async () => {
    const { channel } = makeFake()
    const { emit, waitFor } = collector()
    await channel.open({ connectionId: "c", emit })
    const link = await waitFor((e) => e.type === "link")
    ok(link.type === "link" && link.method === channel.capabilities.linkMethod, "link method did not match capabilities.linkMethod")
  })

  await run(CHECKS[1], async () => {
    const { channel, simulator } = makeFake()
    const { emit, waitFor, events } = collector()
    await channel.open({ connectionId: "c", emit })
    await waitFor((e) => e.type === "link")
    simulator.completeLink("c")
    const open = await waitFor((e) => e.type === "open")
    ok(open.type === "open" && typeof open.handle === "string", "open event missing a handle")
    ok(events.some((e) => e.type === "state" && typeof e.state === "string"), "no state event to persist after linking")
  })

  await run(CHECKS[2], async () => {
    const { channel, simulator } = makeFake()
    const { emit, waitFor } = collector()
    const live = await channel.open({ connectionId: "c", emit })
    await waitFor((e) => e.type === "link")
    simulator.completeLink("c")
    await waitFor((e) => e.type === "open")
    const { id } = await live.send("+15550100", { text: "hi" })
    ok(typeof id === "string" && id.length > 0, "send did not return an id")
    ok(simulator.sent("c").length === 1, "send was not recorded")
  })

  await run(CHECKS[3], async () => {
    const { channel, simulator } = makeFake()
    const { emit, waitFor } = collector()
    await channel.open({ connectionId: "c", emit })
    await waitFor((e) => e.type === "link")
    simulator.completeLink("c")
    await waitFor((e) => e.type === "open")
    simulator.deliver("c", { threadId: "t1", from: "+15550100", text: "hello" })
    const msg = await waitFor((e) => e.type === "message")
    ok(msg.type === "message" && msg.message.text === "hello", "inbound message not delivered")
  })

  await run(CHECKS[4], async () => {
    const { channel, simulator } = makeFake()
    // First: link and capture the persisted state.
    const first = collector()
    await channel.open({ connectionId: "c", emit: first.emit })
    await first.waitFor((e) => e.type === "link")
    simulator.completeLink("c")
    const stateEvent = await first.waitFor((e) => e.type === "state")
    ok(stateEvent.type === "state", "expected a state event")
    // Then: reopen with that state — live, no link step.
    const second = collector()
    await channel.open({ connectionId: "c", state: stateEvent.state, emit: second.emit })
    await second.waitFor((e) => e.type === "open")
    ok(!second.events.some((e) => e.type === "link"), "reconnect should not require a fresh link")
  })

  await run(CHECKS[5], async () => {
    const { channel, simulator } = makeFake()
    const { emit, waitFor } = collector()
    const live = await channel.open({ connectionId: "c", emit })
    await waitFor((e) => e.type === "link")
    simulator.completeLink("c")
    await waitFor((e) => e.type === "open")
    await live.logout()
    await waitFor((e) => e.type === "closed")
  })

  await run(CHECKS[6], async () => {
    const { channel, simulator } = makeFake()
    const { emit, waitFor } = collector()
    simulator.failNextOpen("c")
    await channel.open({ connectionId: "c", emit }).then(
      () => {
        throw new Error("open should have failed")
      },
      () => {}
    )
    await waitFor((e) => e.type === "closed")
  })

  return results
}
