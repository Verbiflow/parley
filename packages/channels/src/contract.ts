/**
 * The one seam every messaging integration implements. WhatsApp is the first `Channel`; Telegram/Instagram/LinkedIn
 * are added later as new modules that fill this same interface and get listed in the registry — nothing in the API,
 * MCP, session pool, or web UI branches per channel. Those layers read `capabilities` (declared, not hard-coded) and
 * dispatch by `connection.channel`.
 */

/** How a user links their account. The link UI renders from this; it never special-cases a channel. */
export type LinkMethod = "qr" | "oauth" | "code" | "cookies"

export type Capabilities = {
  linkMethod: LinkMethod
  /** Can it send/receive media (not just text)? */
  media: boolean
  /** Does it have group conversations? */
  groups: boolean
  /** Does it model threads/conversations distinctly? */
  threads: boolean
  /** Does it report presence/typing? */
  presence: boolean
  /** Can the account delete a message it sent, for everyone in the chat? */
  unsend: boolean
}

/**
 * A message seen on the connection. `threadId` is the chat it belongs to. `fromMe` marks one the account itself sent
 * (from its phone or through Parley), so a synced chat holds both sides of the conversation.
 */
export type InboundMessage = {
  id: string; threadId: string; from: string; text: string; at: string; fromMe?: boolean
  /** The photo/video/voice note/document/sticker it carries. `text` is then its caption, or a placeholder like "[photo]". */
  media?: MediaInfo | undefined
  /** Reactions it already had when it arrived (a history sync carries them on the message). */
  reactions?: Reaction[] | undefined
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker"
/**
 * What a message's attachment is. `ref` is opaque to the host: the channel's own handle for fetching the file later
 * through `LiveConnection.media` (files aren't downloaded until someone asks for one).
 */
export type MediaInfo = {
  kind: MediaKind; mimetype: string | null; fileName?: string | null; size?: number | null
  width?: number | null; height?: number | null; seconds?: number | null; ref: string
  /** A small JPEG preview (base64) when the channel sends one: a video's first frame, a photo or a document's page. */
  thumbnail?: string | null
}

/**
 * Someone reacted to a message (`messageId`, in chat `threadId`). `from` is who reacted (`"me"` with `fromMe`); an
 * empty `emoji` means they took their reaction back. A person has at most one reaction per message: the latest wins.
 */
export type Reaction = { threadId: string; messageId: string; from: string; fromMe?: boolean; emoji: string; at: string }

/**
 * A conversation on the channel: a person (`direct`) or a group. The user picks which chats Parley syncs; agents only
 * ever see synced ones. `name` may be unknown at first and filled in by a later `chats` event.
 */
/** Which way the chat's most recent call went. */
export type CallKind = "incoming" | "outgoing" | "missed"
export type Chat = { id: string; name: string | null; kind: "direct" | "group"; lastMessageAt?: string | undefined; lastCall?: { at: string; kind: CallKind } | undefined }
/**
 * What to send. `text` alone is a message. With `media`, it's a photo/video/voice note/document and `text` is its
 * caption (may be empty). With `react`, it's a reaction: `text` is the emoji, empty to take a reaction back. With
 * `unsend`, it deletes that message (one the account sent) for everyone in the chat; `text` is ignored.
 */
export type OutboundContent = { text: string; media?: OutboundMedia | undefined; react?: ReactTarget | undefined; unsend?: ReactTarget | undefined }
/** A file to send, already fetched: the bytes and what they are. */
export type OutboundMedia = { kind: Exclude<MediaKind, "sticker">; data: Uint8Array; mimetype: string; fileName?: string | undefined; seconds?: number | undefined }
/** The message a reaction (or a deletion) is for, as stored: its id, whether the account sent it, and (in a group) who did. */
export type ReactTarget = { messageId: string; fromMe: boolean; sender?: string | undefined }

/** A stored message to fetch history from (backwards): which chat, which message, who sent it, when. */
export type HistoryAnchor = { threadId: string; messageId: string; fromMe: boolean; sender?: string | undefined; at: string }

/** What a live connection tells the host (the session actor) as it runs. */
export type ChannelEvent =
  /** The user must act to finish linking: scan this QR / open this OAuth URL / enter this code. */
  | { type: "link"; method: LinkMethod; data: string }
  /** Linked and live. `handle` is the account's own address on the channel (e.g. its phone number). */
  | { type: "open"; handle: string }
  /** Opaque channel session state to persist. The host seals it (AES-256-GCM) before storing in Postgres. */
  | { type: "state"; state: string }
  /** Chats the channel learned of (initial history sync, a new conversation, a name change). An upsert, not a full list. */
  | { type: "chats"; chats: Chat[] }
  /** Names for one-to-one chats (e.g. the address book). Only names chats the host already has; never adds any. */
  | { type: "names"; names: Array<{ id: string; name: string }> }
  /** `from` and `to` turned out to be the same chat (e.g. a private id and a phone number): fold `from` into `to`. */
  | { type: "merge"; pairs: Array<{ from: string; to: string }> }
  /** The link-time history sync: `progress` 0–100 when the channel knows it; `done` once it has settled. */
  | { type: "sync"; progress: number | null; done: boolean }
  /** Many messages at once (a history batch): same as that many `message` events, stored in one go. */
  | { type: "messages"; messages: InboundMessage[] }
  /** A message arrived (or was sent from the account's own phone). History sync delivers these too. */
  | { type: "message"; message: InboundMessage }
  /** Reactions added, changed or taken back on messages already seen. */
  | { type: "reactions"; reactions: Reaction[] }
  /** Messages their sender deleted for everyone (from a phone, or through Parley): forget them. */
  | { type: "deleted"; messages: Array<{ threadId: string; messageId: string }> }
  /** The connection closed. `reason` is for logs/UI, not control flow. */
  | { type: "closed"; reason: string }

export type Emit = (event: ChannelEvent) => void

/** A live connection the host holds (one per connected account, multiplexed many-per-worker). */
export interface LiveConnection {
  send(to: string, content: OutboundContent): Promise<{ id: string }>
  /** Fetch a message's attachment by its `MediaInfo.ref`, as a stream (files can be large). Channels without media leave this out. */
  media?(ref: string): Promise<{ body: ReadableStream<Uint8Array>; mimetype: string }>
  /**
   * Ask the platform for up to `count` messages sent before `anchor` (a message the host has). They arrive later as
   * ordinary `messages` events; one already stored is filled in (media, reactions) rather than duplicated. Channels
   * that can't fetch history leave this out.
   */
  backfill?(anchor: HistoryAnchor, count: number): Promise<void>
  /** Unlink the account on the channel; the saved state becomes useless afterward. */
  logout(): Promise<void>
  /** Drop the connection locally (e.g. idle eviction) without unlinking. */
  close(): Promise<void>
}

export type OpenOptions = {
  connectionId: string
  /** Previously-saved opaque state (session creds). Undefined for a fresh link. */
  state?: string | undefined
  /** Proxy URL every socket of this connection must leave through (its exit IP). Undefined means connect directly. */
  proxy?: string | undefined
  emit: Emit
}

/**
 * What the platform said when a send failed, in the host's terms. A channel classifies its own errors into these and
 * throws `SendFailure`; the host decides what each means for the account (pause, back off, halt). Anything else a
 * send throws is treated as `transport_error`: it never reached the platform.
 */
export type SendOutcome = "rate_limited" | "limit_reached" | "challenge" | "auth_expired" | "banned" | "recipient_unavailable" | "transport_error"

export class SendFailure extends Error {
  readonly outcome: SendOutcome
  constructor(outcome: SendOutcome, message: string) {
    super(message)
    this.name = "SendFailure"
    this.outcome = outcome
  }
}

/** A channel connector. One module per integration implements this and is added to the registry. */
export interface Channel {
  readonly id: string
  readonly capabilities: Capabilities
  /**
   * Begin a connection. With no `state`, the channel drives a fresh link (emitting a `link` event, then `open` +
   * `state` once the user completes it). With `state`, it reconnects live with no link step. Returns the live
   * connection handle; lifecycle after that is reported through `emit`.
   */
  open(opts: OpenOptions): Promise<LiveConnection>
}

// ---- Testing surface --------------------------------------------------------

/**
 * A channel's Fake pairs the `Channel` with a simulator of the outside world (the user scanning, inbound messages
 * arriving, a provider failure). The conformance suite drives any channel through its simulator, so every
 * integration is held to the same contract in CI with no real account.
 */
export interface ChannelSimulator {
  /** Simulate the user completing the link (scanning the QR / authorizing), as `handle` (default: unique to the connection). */
  completeLink(connectionId: string, handle?: string): void
  /** Simulate an inbound message. */
  deliver(connectionId: string, message: { id?: string; at?: string; threadId: string; from: string; text: string; fromMe?: boolean; media?: MediaInfo; reactions?: Reaction[] }): void
  /** Simulate reactions arriving (added, changed or taken back). */
  react(connectionId: string, reactions: Reaction[]): void
  /** Simulate messages being deleted for everyone. */
  unsend(connectionId: string, messages: Array<{ threadId: string; messageId: string }>): void
  /** Simulate the channel reporting the account's chats (as on first link / history sync). */
  announceChats(connectionId: string, chats: Chat[]): void
  /** Make the next `open(connectionId)` fail. */
  failNextOpen(connectionId: string): void
  /** What was sent on a connection, for assertions. */
  sent(connectionId: string): Array<{ to: string; content: OutboundContent }>
  /** The history requests made on a connection (`LiveConnection.backfill`), for assertions. */
  backfills(connectionId: string): Array<{ anchor: HistoryAnchor; count: number }>
  /** Make the next send on a connection fail the way the platform would. */
  failNextSend(connectionId: string, outcome: SendOutcome): void
  /** The proxy the connection was last opened through. */
  proxyOf(connectionId: string): string | undefined
}

export interface ChannelFake {
  channel: Channel
  simulator: ChannelSimulator
}
