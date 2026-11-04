import { Hono, type Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { store } from "@parley/auth"
import type { AppContext } from "../context.ts"
import { currentSession, currentUserId, currentViewer, startSession, clearSession, rememberNext as rememberNextPath, takeNext } from "./session.ts"
import { agentSessions, endAgentSession } from "../oauth/store.ts"
import { workosClient, redirectUri } from "./workos.ts"
import { landingPage, dashboardPage, agentsPage, settingsPage, chatsPage, outboxPage, networkPage, activityPage, activityFeed, ACTIVITY_PER_PAGE, type ActivityFilter, type ConnectionSummary, type WebhooksView } from "./pages.ts"
import { ConnectError } from "../sessions/actor.ts"
import { setIgnored } from "../sessions/chats.ts"
import { MAX_DAILY_LIMIT, OutboxError, availability, cancel, getOutbound, listActivity, listOutbound, resume, type ActivityStatus } from "../sessions/outbox.ts"
import { ExitError, PRESET_LIST } from "../sessions/exits.ts"
import { setBehaviour } from "../sessions/store.ts"
import { WebhookError, moveWebhooks } from "../sessions/webhooks.ts"
import { isValidTimeZone, policyFor } from "@parley/pacing"
import { PRESET_IDS, PROXY_KINDS, PROXY_PROTOCOLS, type PresetId, type ProxyKind } from "@parley/proxies"

/**
 * The human-facing web app: sign in (WorkOS AuthKit, or a local dev login), then a dashboard to connect channels.
 * This is separate from the agent's OAuth-over-MCP flow under /oauth — this is a person in a browser.
 */
export function webRoutes(ctx: AppContext): Hono {
  const app = new Hono()
  const workos = workosClient(ctx.config)

  // A signed-out visitor to an /app page (e.g. "Choose chats" from the link page) comes back to it after signing in.
  const rememberNext = (c: Context) => {
    rememberNextPath(c, ctx, new URL(c.req.url).pathname)
    return c.redirect("/")
  }
  const landing = (c: Context) => c.redirect(takeNext(c))
  // The email-only dev login exists only when there's no real sign-in configured (local dev without WorkOS, tests).
  const devLogin = ctx.config.localProvider && !workos

  app.get("/", async (c) => {
    if (await currentUserId(c, ctx)) return landing(c)
    return c.html(landingPage({ workos: Boolean(workos), dev: devLogin }))
  })

  app.get("/auth/start", (c) => {
    if (!workos) return c.text("WorkOS isn't configured. Set WORKOS_CLIENT_ID and WORKOS_API_KEY.", 501)
    const state = crypto.randomUUID()
    setCookie(c, "parley_oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600, secure: (ctx.config.publicUrl ?? "").startsWith("https:") })
    // Straight to Google (WorkOS's GoogleOAuth provider), not the hosted AuthKit page: one click, no email/SSO step,
    // and the person never sees an authkit.app URL. Google must be enabled in the WorkOS environment.
    const url = workos.userManagement.getAuthorizationUrl({ provider: "GoogleOAuth", redirectUri: redirectUri(ctx.config), clientId: ctx.config.workos!.clientId, state })
    return c.redirect(url)
  })

  app.get("/auth/callback", async (c) => {
    if (!workos) return c.text("WorkOS isn't configured.", 501)
    const code = c.req.query("code")
    const state = c.req.query("state")
    if (!code || !state || state !== getCookie(c, "parley_oauth_state")) return c.text("Sign-in failed (bad state). Try again.", 400)
    let result: Awaited<ReturnType<typeof workos.userManagement.authenticateWithCode>>
    try {
      result = await workos.userManagement.authenticateWithCode({ code, clientId: ctx.config.workos!.clientId })
    } catch (e) {
      console.error(JSON.stringify({ msg: "workos sign-in failed", error: e instanceof Error ? e.message : String(e) }))
      return c.html(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="font-family:system-ui;max-width:28rem;margin:5rem auto;text-align:center"><h1 style="font-size:20px">Sign-in didn't go through</h1><p style="color:#666">WorkOS rejected the sign-in. Check that WORKOS_CLIENT_ID and WORKOS_API_KEY are from the same WorkOS environment.</p><p><a href="/auth/start">Try again</a></p></body>`, 502)
    }
    const user = result.user
    const method: store.SignInMethod = result.authenticationMethod === "GitHubOAuth" ? "github" : result.authenticationMethod === "GoogleOAuth" ? "google" : "local"
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    const account = await store.upsertAccount(ctx.sql, { subject: `workos:${user.id}`, email: user.email, name, image: user.profilePictureUrl ?? null, signedInWith: method })
    await startSession(c, ctx, account.id, method)
    return landing(c)
  })

  // Local-only dev sign-in, so the dashboard is usable before WorkOS is wired.
  app.post("/auth/dev", async (c) => {
    if (!devLogin) return c.text("Not available.", 404)
    const email = String((await c.req.formData()).get("email") ?? "").trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return c.text("A valid email is required.", 400)
    const account = await store.upsertAccount(ctx.sql, { subject: `local:${email}`, email, name: email.split("@")[0]!, signedInWith: "local" })
    await startSession(c, ctx, account.id, "local")
    return landing(c)
  })

  /** Resolve the signed-in account for an /app page, or undefined (the caller redirects to sign-in). */
  const viewer = (c: Context): Promise<{ profile: store.Profile; sessionId: string } | undefined> => currentViewer(c, ctx)

  /** How many chats a connection syncs. The caller has already checked the connection is the viewer's. */
  const syncedCount = async (connectionId: string) => {
    const [r] = await ctx.sql<{ n: number }>(`select count(*)::int as n from parley.chat where connection_id = $1 and synced`, [connectionId])
    return r?.n ?? 0
  }

  const mcpUrl = (c: Context) => `${ctx.config.publicUrl ?? new URL(c.req.url).origin}/mcp`

  const queuedTotal = async (userId: string) => {
    const [r] = await ctx.sql<{ n: number }>(
      `select count(*)::int as n from parley.outbound o join parley.connection k on k.id = o.connection_id where k.account_id = $1 and o.status = 'scheduled'`,
      [userId]
    )
    return r?.n ?? 0
  }

  /** Where a form posted from a page goes back to: one of the app's own pages (with its filters), else the outbox. */
  const backTo = (back: string) => (/^\/app(\/[\w-]+)*(\?[\w=&%.+~-]*)?$/.test(back) ? back : "/app/outbox")

  /** The activity log's filter from the query string, keeping only states it knows and accounts that are the viewer's. */
  const activityFilter = (c: Context, accountIds: string[]): ActivityFilter => {
    const s = c.req.query("status")
    const account = c.req.query("account")
    return {
      status: s === "sent" || s === "queued" || s === "failed" || s === "canceled" ? (s as ActivityStatus) : undefined,
      account: account && accountIds.includes(account) ? account : undefined,
      q: c.req.query("q")?.trim().slice(0, 200) || undefined,
    }
  }

  /** Today's sending on a live connection: what went out against its daily limit, what's waiting, and when next. */
  async function summary(userId: string, connectionId: string): Promise<ConnectionSummary> {
    const [{ today }, [q]] = await Promise.all([
      availability(ctx.sql, userId, connectionId, new Date()),
      ctx.sql<{ n: number; next: Date | null }>(
        `select count(*)::int as n, min(scheduled_for) as next from parley.outbound where connection_id = $1 and status = 'scheduled'`,
        [connectionId]
      ),
    ])
    return {
      sentToday: today.sentToday,
      dailyLimit: today.dailyLimit,
      queued: q?.n ?? 0,
      nextAt: q?.next?.toISOString() ?? null,
    }
  }

  app.get("/app", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    const [connections, agents, activity, queued, webhookCounts] = await Promise.all([
      ctx.sessions.list(v.profile.id),
      agentSessions(ctx.sql, v.profile.id),
      listActivity(ctx.sql, v.profile.id, { limit: 8, offset: 0 }),
      queuedTotal(v.profile.id),
      ctx.webhooks.counts(ctx.sql, v.profile.id),
    ])
    // Every live connection's figures at once (they came from the viewer's own list, so ownership is settled).
    const live = connections.filter((conn) => conn.status === "connected")
    const [synced, sums] = await Promise.all([
      Promise.all(live.map((conn) => syncedCount(conn.id))),
      Promise.all(live.map((conn) => summary(v.profile.id, conn.id))),
    ])
    const syncedCounts = new Map<string, number>()
    const summaries = new Map<string, ConnectionSummary>()
    live.forEach((conn, i) => {
      if (synced[i] !== undefined) syncedCounts.set(conn.id, synced[i])
      summaries.set(conn.id, sums[i]!)
    })
    return c.html(dashboardPage({ user: v.profile, connections, agents, mcpUrl: mcpUrl(c), syncedCounts, summaries, queued, recent: activity.entries, webhookCounts }))
  })

  app.post("/app/connect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const form = await c.req.formData().catch(() => undefined)
    const timezone = String(form?.get("timezone") ?? "")
    const country = String(form?.get("country") ?? "")
    // A link still waiting for its scan is where "add a number" picks up, rather than a second pending link.
    const pending = (await ctx.sessions.list(userId)).find((x) => x.channel === "whatsapp" && x.status === "linking" && !x.handle)
    if (pending) return c.redirect(`/link/${pending.id}`)
    try {
      const started = await ctx.sessions.connect(userId, "whatsapp", {
        timezone: isValidTimeZone(timezone) && timezone ? timezone : undefined,
        country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined,
      })
      return c.redirect(`/link/${started.connectionId}`)
    } catch (e) {
      if (e instanceof ConnectError && e.code === "no_exit") return c.redirect(`/app/network?error=${encodeURIComponent(e.message)}`)
      throw e
    }
  })

  /** A connected account's page: its chats, today's sending, its settings and its webhooks. */
  const accountPage = async (c: Context, id: string, hooks: Omit<WebhooksView, "webhooks" | "deliveries"> = {}, code: 200 | 400 | 404 = 200) => {
    const v = await viewer(c)
    if (!v) return rememberNext(c)
    const connection = (await ctx.sessions.list(v.profile.id)).find((x) => x.id === id)
    if (!connection) return c.text("Unknown connection.", 404)
    const [chats, agents, sum, webhooks, deliveries] = await Promise.all([
      ctx.sessions.chats(v.profile.id, id),
      agentSessions(ctx.sql, v.profile.id),
      connection.status === "connected" ? summary(v.profile.id, id) : undefined,
      ctx.webhooks.list(ctx.sql, v.profile.id, { connectionId: id }),
      ctx.webhooks.deliveries(ctx.sql, v.profile.id, { connectionId: id, limit: 20 }),
    ])
    c.header("cache-control", "no-store")
    return c.html(chatsPage({
      user: v.profile, connection, chats, agentCount: agents.length, saved: c.req.query("saved") === "1",
      today: sum ? { sentToday: sum.sentToday, dailyLimit: sum.dailyLimit } : null, queued: sum?.queued ?? 0,
      webhooks: { webhooks, deliveries, ...hooks },
    }), code)
  }
  const NOTICES: Record<string, string> = {
    tested: "Test event queued. It shows under Recent webhook deliveries within a few seconds (refresh to see how it went).",
    saved: "Webhook saved.",
    deleted: "Webhook deleted.",
  }

  // A connected account: its chats, today's sending, its settings and webhooks, on one page.
  app.get("/app/connections/:id", (c) => accountPage(c, c.req.param("id"), { notice: NOTICES[c.req.query("webhook") ?? ""] }))

  // The chats used to have their own page; it's the account page now.
  app.get("/app/connections/:id/chats", (c) => c.redirect(`/app/connections/${c.req.param("id")}`))

  app.post("/app/connections/:id/resume", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await resume(ctx.tx, userId, c.req.param("id"), new Date()).catch((e) => {
      if (!(e instanceof OutboxError)) throw e
    })
    return c.redirect(`/app/connections/${c.req.param("id")}`)
  })

  // Read receipts and typing for this number. An unchecked box isn't sent at all: absent means off.
  app.post("/app/connections/:id/behaviour", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const form = await c.req.formData()
    const ok = await setBehaviour(ctx.sql, userId, c.req.param("id"), { readReceipts: form.get("read_receipts") === "on", typing: form.get("typing") === "on" })
    if (!ok) return c.text("Unknown connection.", 404)
    return c.redirect(`/app/connections/${c.req.param("id")}`)
  })

  app.post("/app/connections/:id/locale", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const form = await c.req.formData()
    const timezone = String(form.get("timezone") ?? "").trim()
    const country = String(form.get("country") ?? "").trim()
    const limit = Number(String(form.get("daily_limit") ?? "").trim() || NaN)
    await ctx.sessions.setLocale(userId, c.req.param("id"), {
      timezone: isValidTimeZone(timezone) && timezone ? timezone : undefined,
      country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined,
      dailyLimit: Number.isInteger(limit) && limit >= 1 && limit <= MAX_DAILY_LIMIT ? limit : undefined,
    }).catch((e) => {
      if (!(e instanceof OutboxError)) throw e
    })
    return c.redirect(`/app/connections/${c.req.param("id")}`)
  })

  app.get("/app/outbox", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    if (c.req.query("view") === "recent") return c.redirect("/app/activity")
    const [scheduled, sending, connections, agents] = await Promise.all([
      listOutbound(ctx.sql, v.profile.id, { status: "scheduled", limit: 200 }),
      listOutbound(ctx.sql, v.profile.id, { status: "sending", limit: 50 }),
      ctx.sessions.list(v.profile.id),
      agentSessions(ctx.sql, v.profile.id),
    ])
    return c.html(outboxPage({ user: v.profile, scheduled: [...sending, ...scheduled], connections, agentCount: agents.length }))
  })

  app.get("/app/activity", async (c) => {
    const v = await viewer(c)
    if (!v) return rememberNext(c)
    const connections = await ctx.sessions.list(v.profile.id)
    const filter = activityFilter(c, connections.map((x) => x.id))
    const pageNo = Math.min(10_000, Math.max(1, Math.floor(Number(c.req.query("page")) || 1)))
    const [page, agents, queued] = await Promise.all([
      listActivity(ctx.sql, v.profile.id, { status: filter.status, connectionId: filter.account, q: filter.q, limit: ACTIVITY_PER_PAGE, offset: (pageNo - 1) * ACTIVITY_PER_PAGE }),
      agentSessions(ctx.sql, v.profile.id),
      queuedTotal(v.profile.id),
    ])
    return c.html(activityPage({ user: v.profile, page, connections, agentCount: agents.length, queuedTotal: queued, filter, pageNo }))
  })

  // The live view's poll: the first page of the same filter, rendered as rows, with every state's count.
  app.get("/app/activity/feed", async (c) => {
    const v = await viewer(c)
    if (!v) return c.json({ error: "signed_out" }, 401)
    const connections = await ctx.sessions.list(v.profile.id)
    const filter = activityFilter(c, connections.map((x) => x.id))
    const compact = c.req.query("compact") === "1"
    const page = await listActivity(ctx.sql, v.profile.id, { status: filter.status, connectionId: filter.account, q: filter.q, limit: compact ? 8 : ACTIVITY_PER_PAGE, offset: 0 })
    c.header("cache-control", "no-store")
    return c.json(activityFeed(page, connections, { ...filter, compact }))
  })

  app.post("/app/outbox/:id/cancel", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await cancel(ctx.tx, userId, c.req.param("id"), new Date()).catch((e) => {
      if (!(e instanceof OutboxError)) throw e
    })
    return c.redirect(backTo(String((await c.req.formData().catch(() => undefined))?.get("back") ?? "")))
  })

  // Delete a sent message for everyone: queued like any other send, so it shows under scheduled until it goes out.
  app.post("/app/outbox/:id/unsend", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const id = c.req.param("id")
    const back = backTo(String((await c.req.formData().catch(() => undefined))?.get("back") ?? ""))
    const m = await getOutbound(ctx.sql, userId, id).catch((e) => {
      if (e instanceof OutboxError) return undefined
      throw e
    })
    if (m) {
      await ctx.sessions.enqueue(userId, m.connectionId, { to: m.chatId, text: "", unsend: id }).catch((e) => {
        if (!(e instanceof OutboxError)) throw e
      })
    }
    return c.redirect(back)
  })

  app.get("/app/network", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    const [providers, exits, connections, agents, total, hosted] = await Promise.all([
      ctx.exits.providers(ctx.sql, v.profile.id),
      ctx.exits.exits(ctx.sql, v.profile.id),
      ctx.sessions.list(v.profile.id),
      agentSessions(ctx.sql, v.profile.id),
      queuedTotal(v.profile.id),
      ctx.sql<{ yes: boolean }>(`select exists (select 1 from parley.proxy_provider where account_id is null and enabled) as yes`),
    ])
    return c.html(networkPage({
      user: v.profile, providers, exits, presets: PRESET_LIST, connections, agentCount: agents.length, queuedTotal: total,
      error: c.req.query("error"), hosted: Boolean(hosted[0]?.yes),
    }))
  })

  app.post("/app/network/providers", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const f = await c.req.formData()
    const get = (k: string) => String(f.get(k) ?? "").trim()
    const kind = (PROXY_KINDS as readonly string[]).includes(get("kind")) ? (get("kind") as ProxyKind) : "residential"
    try {
      if (get("type") === "static") {
        const exits = get("exits").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
          const [url, country] = line.split(/\s+/)
          return { url: url ?? "", country: country ?? "" }
        })
        if (!exits.length) throw new ExitError("invalid", "add at least one exit")
        await ctx.exits.addStatic(ctx.sql, userId, { name: get("name") || "Static list", kind, exits })
      } else {
        const preset = (PRESET_IDS as string[]).includes(get("preset")) ? (get("preset") as PresetId) : undefined
        const overrides: Record<string, unknown> = {}
        if (get("host")) overrides.host = get("host")
        if (get("port")) overrides.port = Number(get("port"))
        if ((PROXY_PROTOCOLS as readonly string[]).includes(get("protocol"))) overrides.protocol = get("protocol")
        if (get("username_template")) overrides.usernameTemplate = get("username_template")
        if (get("password_template")) overrides.passwordTemplate = get("password_template")
        if (get("lifetime")) overrides.sessionLifetimeMinutes = Number(get("lifetime"))
        const countries = get("countries").split(/[\s,]+/).filter((x) => /^[A-Za-z]{2}$/.test(x))
        await ctx.exits.addGateway(ctx.sql, userId, {
          name: get("name") || "Gateway", kind, preset, gateway: overrides, credentials: { username: get("username"), password: get("password") },
          countries, maxExits: get("max_exits") ? Number(get("max_exits")) : undefined,
        })
      }
    } catch (e) {
      if (e instanceof ExitError) return c.redirect(`/app/network?error=${encodeURIComponent(e.message)}`)
      throw e
    }
    return c.redirect("/app/network")
  })

  app.post("/app/network/providers/:id/:action{enable|disable|delete}", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const action = c.req.param("action")
    await (action === "delete" ? ctx.exits.removeProvider(ctx.sql, userId, c.req.param("id")) : ctx.exits.setEnabled(ctx.sql, userId, c.req.param("id"), action === "enable")).catch((e) => {
      if (!(e instanceof ExitError)) throw e
    })
    return c.redirect("/app/network")
  })

  app.post("/app/connections/:id/disconnect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await ctx.sessions.logout(userId, c.req.param("id")).catch(() => {})
    return c.redirect("/app")
  })

  // Relink: sign the old link out and start a fresh one with the same locale. WhatsApp sends the recent-chats list
  // only while a device is linking, so this is how an account linked without it gets its one-to-one chats.
  app.post("/app/connections/:id/relink", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const old = (await ctx.sessions.list(userId)).find((x) => x.id === c.req.param("id"))
    if (!old) return c.text("Unknown connection.", 404)
    await ctx.sessions.logout(userId, old.id).catch(() => {})
    try {
      const started = await ctx.sessions.connect(userId, old.channel, { timezone: old.timezone || undefined, country: old.country ?? undefined })
      // The new link keeps what was ignored (by number / group id), so a rebuilt list doesn't un-ignore anything.
      await ctx.sql(`update parley.connection n set ignored_chats = o.ignored_chats from parley.connection o where n.id = $1 and o.id = $2`, [started.connectionId, old.id])
      // And its webhooks, so the new link keeps calling the same URLs.
      await moveWebhooks(ctx.sql, [old.id], started.connectionId)
      return c.redirect(`/link/${started.connectionId}`)
    } catch (e) {
      if (e instanceof ConnectError && e.code === "no_exit") return c.redirect(`/app/network?error=${encodeURIComponent(e.message)}`)
      throw e
    }
  })

  // Ignore or un-ignore chats in place (the picker calls this per tap). Only the named chats change, so chats that
  // arrived after the page loaded keep syncing.
  app.post("/app/connections/:id/chats/ignore", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.json({ error: "signed out" }, 401)
    const id = c.req.param("id")
    if (!(await ctx.sessions.list(userId)).some((x) => x.id === id)) return c.json({ error: "unknown connection" }, 404)
    const body = await c.req.json().catch(() => ({})) as { chats?: unknown; ignored?: unknown }
    const chats = Array.isArray(body.chats) ? body.chats.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, 1000) : []
    await setIgnored(ctx.sql, id, chats, body.ignored !== false)
    return c.json({ ok: true })
  })

  app.post("/app/connections/:id/chats", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const id = c.req.param("id")
    const chosen = (await c.req.formData()).getAll("chat").map(String).filter(Boolean)
    try {
      await ctx.sessions.chooseChats(userId, id, chosen)
    } catch (e) {
      if (e instanceof ConnectError) return c.text("Unknown connection.", 404)
      throw e
    }
    return c.redirect(`/app/connections/${id}?saved=1`)
  })

  app.get("/app/agents", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    const [agents, queued] = await Promise.all([agentSessions(ctx.sql, v.profile.id), queuedTotal(v.profile.id)])
    return c.html(agentsPage({ user: v.profile, agents, mcpUrl: mcpUrl(c), queuedTotal: queued }))
  })

  app.post("/app/agents/:id/disconnect", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    await endAgentSession(ctx.sql, userId, c.req.param("id"))
    return c.redirect("/app/agents")
  })

  // ---- Webhooks: each number's, on its account page (#webhooks). ---------------------------------------------------

  // The old top-level page: webhooks live on each number's page now.
  app.get("/app/webhooks", (c) => c.redirect("/app"))

  // Added from the page: answered with the page itself (not a redirect), so the new secret is shown once and never
  // travels in a URL.
  app.post("/app/connections/:cid/webhooks", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const cid = c.req.param("cid")
    const f = await c.req.formData()
    try {
      const { webhook, secret } = await ctx.webhooks.create(ctx.sql, userId, {
        connectionId: cid, url: String(f.get("url") ?? ""), events: f.getAll("events").map(String), description: String(f.get("description") ?? ""), createdBy: "dashboard",
      })
      return accountPage(c, cid, { revealed: { id: webhook.id, secret, fresh: true } })
    } catch (e) {
      if (e instanceof WebhookError) return e.code === "not_found" ? c.text("Unknown connection.", 404) : accountPage(c, cid, { error: e.message }, 400)
      throw e
    }
  })

  app.post("/app/connections/:cid/webhooks/:id/:action{update|enable|disable|delete|test|rotate|secret}", async (c) => {
    const userId = await currentUserId(c, ctx)
    if (!userId) return c.redirect("/")
    const cid = c.req.param("cid")
    const id = c.req.param("id")
    const back = (done?: string) => c.redirect(`/app/connections/${encodeURIComponent(cid)}${done ? `?webhook=${done}` : ""}#webhooks`)
    try {
      // The webhook must be on this number (and the viewer's): anything else is someone else's, or a mistake.
      if ((await ctx.webhooks.get(ctx.sql, userId, id)).connectionId !== cid) return c.text("Unknown webhook.", 404)
      switch (c.req.param("action")) {
        case "update": {
          const f = await c.req.formData()
          await ctx.webhooks.update(ctx.sql, userId, id, { url: String(f.get("url") ?? ""), events: f.getAll("events").map(String), description: String(f.get("description") ?? "") })
          return back("saved")
        }
        case "enable":
        case "disable":
          await ctx.webhooks.update(ctx.sql, userId, id, { enabled: c.req.param("action") === "enable" })
          return back()
        case "delete":
          await ctx.webhooks.remove(ctx.sql, userId, id)
          return back("deleted")
        case "test":
          await ctx.webhooks.test(ctx.sql, userId, id)
          return back("tested")
        case "rotate": {
          const { secret } = await ctx.webhooks.rotateSecret(ctx.sql, userId, id)
          return accountPage(c, cid, { revealed: { id, secret, fresh: true } })
        }
        default:
          return accountPage(c, cid, { revealed: { id, secret: await ctx.webhooks.secret(ctx.sql, userId, id), fresh: false } })
      }
    } catch (e) {
      if (e instanceof WebhookError) return e.code === "not_found" ? c.text("Unknown webhook.", 404) : accountPage(c, cid, { error: e.message }, 400)
      throw e
    }
  })

  app.get("/app/settings", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    const [sessions, agents, queued] = await Promise.all([store.browserSessions(ctx.sql, v.profile.id), agentSessions(ctx.sql, v.profile.id), queuedTotal(v.profile.id)])
    return c.html(settingsPage({ user: v.profile, sessions, currentSessionId: v.sessionId, agentCount: agents.length, queuedTotal: queued }))
  })

  app.post("/app/settings/sessions/:id/end", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    if (c.req.param("id") === v.sessionId) {
      await clearSession(c, ctx)
      return c.redirect("/")
    }
    await store.endBrowserSession(ctx.sql, v.profile.id, c.req.param("id"))
    return c.redirect("/app/settings")
  })

  app.post("/app/settings/sessions/end-others", async (c) => {
    const v = await viewer(c)
    if (!v) return c.redirect("/")
    await store.endOtherBrowserSessions(ctx.sql, v.profile.id, v.sessionId)
    return c.redirect("/app/settings")
  })

  app.post("/auth/signout", async (c) => {
    await clearSession(c, ctx)
    return c.redirect("/")
  })

  return app
}
