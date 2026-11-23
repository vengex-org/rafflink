import { readStored, writeStored } from "../lib/safe-storage.ts"
import { dictionaryLoaders, type Language } from "./dictionaries.ts"

export type { Language }

/** Every language Rafflink speaks or is being translated into, in the picker's order, each named in itself. */
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
} as const

export type KnownLanguage = keyof typeof languageNames

/** The languages that have a dictionary, in the picker's order. */
export const languages: readonly Language[] = Object.keys(languageNames).filter(isLanguage)

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
  return text !== null && isLanguage(text) ? text : null
}

/** The language of the tag's primary subtag (`de` for `de-AT`) when it has a dictionary, else English. */
export function detectLanguage(browserLanguage: string): Language {
  return parseLanguage(browserLanguage.toLowerCase().split("-")[0] ?? null) ?? "en"
}

function isLanguage(text: string): text is Language {
  return Object.hasOwn(dictionaryLoaders, text)
}
