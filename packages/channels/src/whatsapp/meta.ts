import type { Capabilities } from "../contract.ts"

/**
 * WhatsApp's identity and declared capabilities, with no Baileys import — so the edge app (Cloudflare Worker), which
 * never opens a socket, can list the channel without bundling the WhatsApp client.
 */
export const WHATSAPP_ID = "whatsapp"
export const WHATSAPP_CAPABILITIES: Capabilities = { linkMethod: "qr", media: true, groups: true, threads: true, presence: false }
