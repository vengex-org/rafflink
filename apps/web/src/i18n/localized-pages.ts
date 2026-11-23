import { useLocation, useNavigate } from "react-router"
import { localizedPath, pageOfPath, type LocalizedPage } from "../lib/routes.ts"
import { useI18n } from "./i18n.tsx"
import type { Language } from "./language.ts"

/** The address of `page` in the language shown. */
export function useLocalizedPath(page: LocalizedPage): string {
  return localizedPath(useI18n().language, page)
}

/**
 * Picks a language as the person's choice. On a localized page the address names the language, so the page opens
 * at its address in the picked language; the query is left behind, since a one-time parameter in it was used.
 */
export function useChooseLanguage(): (language: Language) => void {
  const { setLanguage } = useI18n()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (language) => {
    setLanguage(language)
    const page = pageOfPath(pathname)?.page
    if (page !== undefined) navigate(localizedPath(language, page), { replace: true })
  }
}
