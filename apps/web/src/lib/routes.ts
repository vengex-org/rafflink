import type { StreamerFeature } from "@rafflink/core/domain/streamer-features"
import { languages, sourceLanguage } from "@rafflink/core/lib/languages"
import type { Platform } from "@rafflink/core/platform/provider"
import { pageAddressLanguage } from "../i18n/page-language.ts"
import type { SitePage } from "../site/site-page.ts"
import type { OverlayOptions } from "./overlay-options.ts"

export {
  drawPath,
  giveawayPath,
  historyPath,
  localizedPages,
  localizedPath,
  moderatorLivePath,
  moderatorOpenPath,
  moderatorSignInOutcomes,
  pageOfPath,
  verifyPath,
  withoutSourcePrefix,
  type LocalizedPage,
} from "@rafflink/core/lib/page-paths"

/** The first segments of the pages that are not giveaways; their canonical spelling is lowercase. `g` is the old giveaway link, `s` a streamer's history, a language code the localized pages. */
export const staticSegments = [
  ...languages.filter((language) => language !== sourceLanguage),
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
  "s",
]

/** The fixed words after a first segment or a giveaway code; the segments between them are ids and tokens, whose case is theirs. */
export const staticSubSegments = ["new", "created", "settings", "verify"]

export const dashboardPath = "/dashboard"
export const settingsPath = "/dashboard/settings"
export const adminPath = "/admin"
export const verifyLookupPath = "/verify"

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

/**
 * The header's sign-in on the page at `pathname` and `search`: the dashboard's sign-in card, which brings the streamer
 * back to that page; on the dashboard itself, the page as it is, whose card already knows where to return. A marketing
 * page has nothing left to see, so its sign-in lands on the dashboard: the home and legal pages and the deployment's
 * `prerenderPages` in every language, and its `marketingPaths`.
 */
export function headerSignInPath(
  pathname: string,
  search: string,
  site: {
    readonly prerenderPages: readonly SitePage[]
    readonly marketingPaths: readonly string[]
  },
): string {
  if (pathname === dashboardPath) return `${pathname}${search}`
  const path = pathname.replace(/\/+$/, "")
  if (pageAddressLanguage(pathname, site.prerenderPages) !== null) return dashboardPath
  if (site.marketingPaths.includes(path)) return dashboardPath
  return withQuery(dashboardPath, new URLSearchParams({ return: `${pathname}${search}` }))
}

/** Signs a streamer in on `platform` and sends them back to `returnTo`; the dashboard is where they land when the link names none. */
export function streamerSignInPath(platform: Platform, returnTo: string): string {
  const query = new URLSearchParams()
  if (returnTo !== dashboardPath) query.set("return", returnTo)
  return withQuery(`/auth/${platform}/streamer/start`, query)
}

/** A moderator's sign-in for the link that just asked for it; the server remembers which link in a cookie. */
export const moderatorSignInPath = "/auth/twitch/moderator/start"
/** Signs the streamer in again on their platform with the scopes the features need, then back to `returnTo`. */
export function featureReconnectPath(
  platform: Platform,
  features: readonly StreamerFeature[],
  returnTo: string,
): string {
  const query = new URLSearchParams({ features: features.join(","), return: returnTo })
  return withQuery(`/auth/${platform}/streamer/start`, query)
}

/** Signs a viewer in on the giveaway's platform; the server sends a link naming another platform on to the giveaway's. */
export function viewerSignInPath(platform: Platform, code: string): string {
  return `/auth/${platform}/viewer/start?giveaway=${encodeURIComponent(code)}`
}

function withQuery(path: string, query: URLSearchParams): string {
  const text = query.toString()
  return text === "" ? path : `${path}?${text}`
}
