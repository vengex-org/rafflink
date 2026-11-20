import { readStored, writeStored } from "../lib/safe-storage.ts"

export const languages = ["en", "sk", "cs"] as const
export type Language = (typeof languages)[number]

export const languageStorageKey = "rafflink-language"

/** The language the person chose before, else the one their browser asks for. */
export function initialLanguage(): Language {
  return parseLanguage(readStored(languageStorageKey)) ?? detectLanguage(navigator.language)
}

export function storeLanguage(language: Language): void {
  writeStored(languageStorageKey, language)
}

/** Narrows a stored value once; anything else is not a language. */
export function parseLanguage(text: string | null): Language | null {
  return languages.find((language) => language === text) ?? null
}

/** Czech for `cs*`, Slovak for `sk*`, English for every other tag. */
export function detectLanguage(browserLanguage: string): Language {
  const primary = browserLanguage.toLowerCase().split("-")[0]
  if (primary === "cs") return "cs"
  if (primary === "sk") return "sk"
  return "en"
}
