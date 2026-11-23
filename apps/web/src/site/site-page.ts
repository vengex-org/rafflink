import type { Language } from "@rafflink/core/lib/languages"

/**
 * A page of a deployment that the web build prerenders in every language, beside the home and legal pages: at
 * `segmentPath(language, segment)` of the page model, `/compare` and `/de/compare`. Its routes are among the
 * deployment's `siteRoutes`.
 */
export interface SitePage {
  readonly segment: string
  /** The title and description search engines and link previews show for the page in `language`. */
  meta(language: Language): { readonly title: string; readonly description: string }
}
