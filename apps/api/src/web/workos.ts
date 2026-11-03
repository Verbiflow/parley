import { WorkOS } from "@workos-inc/node"
import type { IdentityConfig } from "@parley/auth"

/**
 * WorkOS AuthKit: the hosted sign-in that gives us Google/GitHub/etc. behind one integration (what mako-cloud used).
 * Returns undefined when WorkOS isn't configured, so the web app can still offer the local dev sign-in.
 */
export function workosClient(config: IdentityConfig): WorkOS | undefined {
  if (!config.workos) return undefined
  return new WorkOS(config.workos.apiKey, { clientId: config.workos.clientId })
}

/** Must exactly match a redirect URI registered in the WorkOS dashboard. */
export function redirectUri(config: IdentityConfig): string {
  const base = config.publicUrl ?? "http://127.0.0.1:8787"
  return `${base}/auth/callback`
}
