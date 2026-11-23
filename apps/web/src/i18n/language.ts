import { isLanguage, type Language } from "@rafflink/core/lib/languages"
import { pageOfPath } from "../lib/routes.ts"
import { readStored, writeStored } from "../lib/safe-storage.ts"

export { languages } from "@rafflink/core/lib/languages"
export type { Language }

/** Every language, each named in itself. */
export const languageNames = {
  en: "English",
  sk: "Slovenčina",
  cs: "Čeština",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pl: "Polski",
  pt: "Português",
} as const satisfies Readonly<Record<Language, string>>

export const languageStorageKey = "rafflink-language"

/** The language the person chose before, else the one their browser asks for. */
export function initialLanguage(): Language {
  return storedLanguage() ?? detectLanguage(navigator.language)
}

/** The language the person chose in the picker or by a `?lang=` link, null when they never chose one. */
export function storedLanguage(): Language | null {
  return parseLanguage(readStored(languageStorageKey))
}

export function storeLanguage(language: Language): void {
  writeStored(languageStorageKey, language)
}

/** The language in the address of a localized page, which wins over any choice there; null on every other page. */
export function addressLanguage(pathname: string): Language | null {
  return pageOfPath(pathname)?.language ?? null
}

/** The language a page opens in: the one in its address, else {@link initialLanguage}. */
export function openingLanguage(inAddress: Language | null): Language {
  return inAddress ?? initialLanguage()
}

/** Narrows a stored value once; anything else is not a language. */
export function parseLanguage(text: string | null): Language | null {
  return text !== null && isLanguage(text) ? text : null
}

/** The language of the tag's primary subtag (`de` for `de-AT`) when it has a dictionary, else English. */
export function detectLanguage(browserLanguage: string): Language {
  return parseLanguage(browserLanguage.toLowerCase().split("-")[0] ?? null) ?? "en"
}
