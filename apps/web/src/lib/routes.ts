import type { OverlayOptions } from "./overlay-options.ts"

export {
  drawPath,
  giveawayPath,
  moderatorLivePath,
  moderatorOpenPath,
  moderatorSignInOutcomes,
  verifyPath,
} from "@rafflink/core/lib/page-paths"

/** The first segments of the pages that are not giveaways; their canonical spelling is lowercase. `g` is the old giveaway link. */
export const staticSegments = [
  "dashboard",
  "admin",
  "privacy",
  "terms",
  "verify",
  "draw",
  "live",
  "mod",
  "overlay",
  "g",
]

/** The fixed words after a first segment or a giveaway code; the segments between them are ids and tokens, whose case is theirs. */
export const staticSubSegments = ["new", "created", "verify"]

export const homePath = "/"
export const dashboardPath = "/dashboard"
export const verifyLookupPath = "/verify"
export const privacyPath = "/privacy"
export const termsPath = "/terms"

export function livePath(id: string): string {
  return `/live/${encodeURIComponent(id)}`
}

/** The overlay link with the options that differ from the defaults. */
export function overlayPath(id: string, overlayToken: string, options?: OverlayOptions): string {
  const query = new URLSearchParams()
  if (options !== undefined && options.mode !== "auto") query.set("mode", options.mode)
  if (options?.qr === true) query.set("qr", "1")
  return withQuery(`/overlay/${encodeURIComponent(id)}/${encodeURIComponent(overlayToken)}`, query)
}

/** The create wizard: `from` fills it with the answers of that giveaway, `step` opens one of its steps. */
export function dashboardNewPath(
  options: { readonly from?: string; readonly step?: number } = {},
): string {
  const query = new URLSearchParams()
  if (options.from !== undefined) query.set("from", options.from)
  if (options.step !== undefined) query.set("step", String(options.step))
  return withQuery("/dashboard/new", query)
}

export function dashboardCreatedPath(id: string): string {
  return `/dashboard/created/${encodeURIComponent(id)}`
}

/** Signs a streamer in and sends them back to `returnTo`; the dashboard is where they land when the link names none. */
export function streamerSignInPath(returnTo: string): string {
  const query = new URLSearchParams()
  if (returnTo !== dashboardPath) query.set("return", returnTo)
  return withQuery("/auth/twitch/streamer/start", query)
}

/** A moderator's sign-in for the link that just asked for it; the server remembers which link in a cookie. */
export const moderatorSignInPath = "/auth/twitch/moderator/start"
/** Signs the streamer in again with the scopes chat entry needs, then back to `returnTo`. */
export function chatEntryReconnectPath(returnTo: string): string {
  const query = new URLSearchParams({ scopes: "chat-entry", return: returnTo })
  return withQuery("/auth/twitch/streamer/start", query)
}

export function viewerSignInPath(code: string): string {
  return `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`
}

function withQuery(path: string, query: URLSearchParams): string {
  const text = query.toString()
  return text === "" ? path : `${path}?${text}`
}
