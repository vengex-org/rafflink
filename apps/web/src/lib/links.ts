import type { OverlayOptions } from "./overlay-options.ts"
import { giveawayPath, moderatorOpenPath, overlayPath, verifyPath } from "./routes.ts"

export function shareUrl(code: string): string {
  return new URL(giveawayPath(code), window.location.origin).href
}

export function verifyUrl(code: string): string {
  return new URL(verifyPath(code), window.location.origin).href
}

/** The host viewers type, the same one the share links carry, so a self-hosted overlay names its own deployment. */
export function siteHost(): string {
  return window.location.host
}

export function overlayUrl(id: string, overlayToken: string, options?: OverlayOptions): string {
  return new URL(overlayPath(id, overlayToken, options), window.location.origin).href
}

/** A moderator link: the token rides in the fragment, which the browser never sends to a server. */
export function moderatorUrl(token: string): string {
  return new URL(`${moderatorOpenPath}#${token}`, window.location.origin).href
}

export const repositoryUrl = "https://github.com/vengex-org/rafflink"

/** The README section that lists the Twitch app settings, including the redirect URLs. */
export const setupGuideUrl = `${repositoryUrl}#twitch-app-registration`

/** Cloudflare's page of the Workers plans, where the owner compares Free and Paid before paying in the dashboard. */
export const cloudflarePlansUrl = "https://www.cloudflare.com/plans/developer-platform/"
