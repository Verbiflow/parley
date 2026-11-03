import type { Channel } from "@parley/channels"
import { whatsappChannel } from "@parley/channels/whatsapp"

/**
 * The channels this deployment offers. Adding an integration is one import + one entry here — it then appears in the
 * MCP tools, the connect flow, and the link page automatically. Tests inject Fakes instead of this list.
 */
export const channels: Channel[] = [whatsappChannel]
