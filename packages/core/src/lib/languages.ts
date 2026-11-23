/** Every language Rafflink speaks, in the order the language picker shows them. */
export const languages = ["en", "sk", "cs", "de", "es", "fr", "it", "pl", "pt"] as const

export type Language = (typeof languages)[number]

/** The language every text is written in first: the fallback, and the language of the addresses without a language. */
export const sourceLanguage = "en" satisfies Language

export function isLanguage(text: string): text is Language {
  return languages.some((language) => language === text)
}
