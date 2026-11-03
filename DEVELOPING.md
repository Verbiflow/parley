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
packages/auth/        identity: db, migrations, credentials, tokens, sealing, secrets, store  ← Phase 1 (done)
packages/channels/    the Channel connector framework; whatsapp is the first entry            ← Phase 3+
apps/api/             Hono: web pages + REST + OAuth AS + MCP endpoint + session pool          ← Phase 2+
```

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
