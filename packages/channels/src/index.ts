// @parley/channels — the channel connector framework. WhatsApp is the first entry; adding a channel is one module
// plus one line in the registry, after which it appears in the API, MCP tools, link UI, and conformance suite.
export type {
  Channel,
  Capabilities,
  LinkMethod,
  ChannelEvent,
  Emit,
  LiveConnection,
  OpenOptions,
  InboundMessage,
  MediaInfo,
  MediaKind,
  Reaction,
  Chat,
  CallKind,
  OutboundContent,
  OutboundMedia,
  ReactTarget,
  HistoryAnchor,
  ChannelSimulator,
  ChannelFake,
  SendOutcome,
} from "./contract.ts"
export { SendFailure } from "./contract.ts"
export { CHANNELS, channelById } from "./registry.ts"
