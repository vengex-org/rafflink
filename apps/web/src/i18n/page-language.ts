import { languages, type Language } from "@rafflink/core/lib/languages"
import { segmentPath } from "@rafflink/core/lib/page-paths"
import type { SitePage } from "../site/site-page.ts"
import { prerenderPages } from "../site/site.tsx"
import { addressLanguage } from "./language.ts"

/**
 * The language in the address of a localized page or of one of the deployment's `prerenderPages`, which wins over
 * any choice there, as on the prerendered page; null on every other page. `pages` stands in for the deployment's.
 */
export function pageAddressLanguage(
  pathname: string,
  pages: readonly SitePage[] = prerenderPages,
): Language | null {
  const path = pathname.replace(/\/+$/, "")
  return (
    addressLanguage(pathname)
    ?? languages.find((language) =>
      pages.some((page) => segmentPath(language, page.segment) === path),
    )
    ?? null
  )
}
