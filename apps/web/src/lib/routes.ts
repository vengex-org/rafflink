import type { OverlayOptions } from "./overlay-options.ts"

export { giveawayPath, verifyPath } from "@rafflink/core/lib/page-paths"

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

export function viewerSignInPath(code: string): string {
  return `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`
}

function withQuery(path: string, query: URLSearchParams): string {
  const text = query.toString()
  return text === "" ? path : `${path}?${text}`
}
