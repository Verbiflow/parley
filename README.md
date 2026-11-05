# Parley

Messaging infrastructure for agents. Parley lets your agents text people from your own accounts, at a human pace, with every message on record.

[Website](https://itsparley.com) · [Get started](https://app.itsparley.com) · [Run it yourself](DEVELOPING.md)

![Parley's landing page: an agent asks Claude to send a deck, Parley holds the message for a natural gap, then it arrives in the chat](.github/assets/hero.jpg)

You link an account once, the same way you'd add a new device. Any agent that speaks MCP can then read your conversations, reply, react and reach out. Parley doesn't send at machine speed. It queues each message and sends it when you plausibly would: inside your local hours, with gaps between messages, and under daily limits that start low on a new account.

WhatsApp is live. iMessage, Slack, LinkedIn and Gmail are next. They will use the same MCP tools, so an agent you set up today keeps working as channels arrive.

> Early development. The MCP tools are stable enough to build on, but expect changes.

## How it works

1. **Connect an account.** Sign in at [app.itsparley.com](https://app.itsparley.com) and link WhatsApp by scanning a QR code from *Linked devices*. Your phone keeps working as normal. You can link several numbers and choose which chats agents can see.
2. **Add Parley to your agent.** Paste `https://app.itsparley.com/mcp` into any client that supports remote MCP servers, then sign in once.
3. **Ask.** "Send Maya the Q4 deck and ask if Thursday at 3 still works." The agent calls `send_message`, and Parley sends the message at the next natural slot.

```sh
# Claude Code
claude mcp add --transport http parley https://app.itsparley.com/mcp
```

```json
// Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "parley": { "url": "https://app.itsparley.com/mcp" } } }
```

Other clients that support remote MCP servers, such as Claude, ChatGPT and Codex, take the same URL.

## What your agent gets

![The four things Parley gives an agent: it sends as you, paces like a person, sends rich messages, and keeps a record](.github/assets/features.jpg)

**It sends as you.** Messages come from your own number, in chats people already have with you. There's no bot account and no "sent by AI" label.

**It sends at a human pace.** Messaging apps flag accounts that send like software. Agents never send directly. `send_message` puts the message in an outbox and reserves the account's next human-paced slot:

- inside the account's active hours, in its own timezone, if you turn them on for that number (off by default)
- with random gaps between messages, plus bursts and breaks
- under daily caps per kind of message, which start low, grow as the account warms up, and halve when the platform pushes back
- with replies going ahead of new conversations once those hit their cap

When the platform answers with a rate limit or a checkpoint, Parley backs off, pauses that kind of message, or stops and waits for you. It doesn't retry blindly.

**It handles rich messages.** Formatting, photos, video, voice notes, documents and reactions go out the way the app shows them. Incoming media is available to the agent through `get_media`.

**It keeps everything on record.** You can see which agent sent what, when it went out, and whether it was delivered and read. You can cancel anything still queued, delete a sent message for everyone, or disconnect an agent from the dashboard, which cuts off its access immediately.

## MCP tools

| Area | Tools |
| --- | --- |
| Accounts | `list_channels`, `list_connections`, `connect`, `connection_status` |
| Reading | `read_inbox`, `list_chats`, `search`, `get_notifications`, `load_history`, `get_media` |
| Sending | `send_message`, `react_to_message`, `delete_message` |
| Outbox | `send_availability`, `list_outbox`, `message_status`, `cancel_message` |
| Webhooks | `create_webhook`, `list_webhooks`, `update_webhook`, `delete_webhook`, `test_webhook`, `resend_webhook_delivery` |

With several accounts linked, tools take a `connection_id` (or just the account's number), so one agent can work across a personal and a work number. Reading tools cover every account unless you filter. `send_availability` tells the agent when it can next send and why, so it can plan instead of guessing.

## Will my account get banned?

Nobody can promise it won't, because messaging apps don't publish their limits for personal accounts. Parley's defaults stay below the levels where people report getting restricted. A new account starts slow, and Parley backs off as soon as the app pushes back. If you run Parley yourself, you can also send each account through its own residential or ISP proxy in the account's country. See [DEVELOPING.md](DEVELOPING.md#egress-proxy-providers-and-exits).

## Run it yourself

Parley is a Node 24 app on Postgres and Redis. [DEVELOPING.md](DEVELOPING.md) covers setup, tests, and linking a real WhatsApp account locally. [deploy/README.md](deploy/README.md) covers how production runs.

```sh
npm install
export DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres
npm run check    # typecheck and the full test suite
```

```
apps/api/            the app: dashboard, sign-in, OAuth, the MCP endpoint, sessions and the outbox
packages/auth/       accounts, tokens, sealed secrets, migrations
packages/channels/   the channel connector framework; WhatsApp is the first
packages/pacing/     human pacing: active hours, gaps, caps, warmup (pure functions)
packages/proxies/    egress through proxy providers, one exit per account
site/                itsparley.com, a static Next.js site on its own Worker
```

In production, the app runs as a Cloudflare Worker at app.itsparley.com. The live channel sockets run on a separate sessions service, and the marketing site is a Worker of its own at itsparley.com. A push to `main` runs the tests and deploys all three.

## License

[Elastic License 2.0](LICENSE) (SPDX: `Elastic-2.0`). You can read, run and modify the code, and self-host it. You can't offer Parley to others as a hosted or managed service.

Parley isn't affiliated with Meta, Apple, Google, Slack or LinkedIn.
