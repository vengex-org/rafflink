import { languages, type Language } from "@rafflink/core/lib/languages"
import { segmentPath } from "@rafflink/core/lib/page-paths"
import { prerenderPages } from "../site/site.tsx"
import { addressLanguage } from "./language.ts"

/**
 * The language in the address of a localized page or of one of the deployment's `prerenderPages`, which wins over
 * any choice there, as on the prerendered page; null on every other page.
 */
export function pageAddressLanguage(pathname: string): Language | null {
  const path = pathname.replace(/\/+$/, "")
  return (
    addressLanguage(pathname)
    ?? languages.find((language) =>
      prerenderPages.some((page) => segmentPath(language, page.segment) === path),
    )
    ?? null
  )
}
