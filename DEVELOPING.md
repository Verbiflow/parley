# Developing Parley

Parley is an open messaging gateway for AI agents. Sign up, link a channel (WhatsApp first), and use it over MCP.
The service holds the live channel sessions server-side and stores their credentials, sealed, in Postgres (RDS).

Its auth (accounts, sign-in, the device-code grant, connection tokens, sealed secrets) is lifted from
`Verbiflow/mako-cloud` and re-homed on plain Node + Postgres — see `packages/auth`.

## Requirements

- **Node 24+** (the test runner executes `.ts` directly via Node's type stripping)
- **PostgreSQL 13+** (uses `gen_random_uuid()`, `generated always as identity`, schemas)
- **Redis** (from Phase 5 on: the connection→worker registry and pub/sub)

## Layout

```
packages/auth/        identity: db, migrations, credentials, tokens, sealing, secrets, store
packages/channels/    the Channel connector framework; whatsapp is the first entry
packages/pacing/      human pacing: active hours, gaps, bursts/breaks, caps, warmup, outcome policies (pure)
packages/proxies/     egress: provider presets, gateway sticky-session templates, proxy agents (pure)
apps/api/             Hono: web console + OAuth AS + MCP endpoint + session pool + outbox dispatcher
```

## Sending: the outbox and human pacing

Agents never send directly. `send_message` queues into `parley.outbound` and reserves the connection's next
human-paced slot (`packages/pacing` `planNext`), under a row lock on the connection so concurrent sends queue
instead of colliding:

- inside the account's local active hours (`parley.connection.timezone`), with random gaps, bursts and breaks
- daily caps per action that start low and warm up (`warmup`), and halve on pushback
- replies interleave ahead of conversation openers that hit their cap

The worker holding a connection's live socket runs the dispatcher (`Sessions.dispatchDue`, every 3s): it claims at
most one due message per connection with a lease, sends it, and reports the outcome. `OUTCOME_POLICIES` decides
what each platform answer means: back off on a rate limit, pause one action on a stated cap, halt for a person on a
checkpoint, fail the message when the recipient is unreachable. A lapsed lease fails as `outcome_unknown` rather
than risk sending twice. Agents see all of it through `send_availability`, `list_outbox` and `cancel_message`.

## Egress: proxy providers and exits

With a proxy provider configured (dashboard → Network), every connection's socket leaves through one exit in its
own country, from the moment it links. Gateways (Bright Data, Oxylabs, Decodo, IPRoyal, or any custom
username/password template) mint one sticky session per connection; static lists (ISP, datacenter, your own servers
— e.g. a pool built with the AWS CLI) are imported as fixed exits. An exit never fronts two connections on the same
channel (enforced by partial unique indexes), repeated transport failures retire it and reconnect through a fresh
one, and a ban burns it. Credentials are sealed like every other secret.

## Rate limits

Per agent on `/mcp`, per client IP on sign-in endpoints and dashboard writes (`apps/api/src/ratelimit.ts`). Shared
across workers in Redis when `REDIS_URL` is set; in memory otherwise. Over the limit: `429` with `Retry-After`.

## Setup

```sh
npm install

# A local Postgres the tests can create throwaway databases in (trust auth is fine for dev):
#   DATABASE_ADMIN_URL defaults to postgres://postgres@127.0.0.1:5432/postgres
export DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres

npm run check      # typecheck + every test (fresh Postgres DB per test file)
npm test           # just the tests
npm run typecheck  # just the types
```

## Testing model (mirrors mako-cloud)

- Runner: `node --test` + `node:assert/strict`.
- Each test file gets its **own freshly-migrated database** via `packages/auth/test/database.ts` `testDatabase()`,
  dropped when the file finishes. Real Postgres, no mocks for the DB layer.
- From Phase 3, every channel's `Fake` must pass the shared **conformance suite** — no real account needed in CI.

## Try WhatsApp end to end

With Node 24 + a local Postgres + Redis running:

```sh
createdb parley   # or: psql -c 'create database parley'
export PARLEY_ENV=local
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/parley
export PUBLIC_URL=http://127.0.0.1:8787

npm run migrate            # apply the schema
npm run dev                # start the API on :8787 (leave running)

# in another terminal — drives the agent flow, prints a link URL to open:
EMAIL=you@example.com npm run try:whatsapp -- +15551234567
```

`try:whatsapp` signs in over OAuth, calls the `connect` MCP tool, and prints a `link_url`. Open it in a browser,
scan the QR from **WhatsApp → Linked devices → Link a device**, and the page flips to "Connected". If you passed a
phone number, it then sends that number a test message. (The QR itself is verified in dev; linking needs your phone.)

## Configuration

See `.env.example`. Locally, `PARLEY_ENV=local` supplies public test keys for `SIGN_IN_KEY` and
`CONNECTION_SIGNING_KEY`; every deployed environment must set its own (the config refuses the local keys outside
`local`). Secrets (`SIGN_IN_KEY`, `CONNECTION_SIGNING_KEY`, WorkOS) belong in a secrets manager, never in the repo.
