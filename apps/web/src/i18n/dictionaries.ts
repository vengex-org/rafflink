import { en, type MessageKey } from "./en.ts"
import type { KnownLanguage } from "./language.ts"

export type { MessageKey }

export type Dictionary = Readonly<Record<MessageKey, string>>

/**
 * Where each language's dictionary comes from. English is the source and ships in the main bundle; every other
 * dictionary is its own chunk, loaded when the language is first shown. A new language is its dictionary file
 * plus one line here; the picker and the browser detection follow this list.
 */
export const dictionaryLoaders = {
  en: async () => en,
  sk: async () => (await import("./sk.ts")).sk,
  cs: async () => (await import("./cs.ts")).cs,
  de: async () => (await import("./de.ts")).de,
  es: async () => (await import("./es.ts")).es,
  pt: async () => (await import("./pt.ts")).pt,
} satisfies { readonly [Code in KnownLanguage]?: () => Promise<Dictionary> }

export type Language = keyof typeof dictionaryLoaders

const loaded = new Map<Language, Dictionary>([["en", en]])

/** The dictionary of a language loaded before, else undefined. */
export function loadedDictionary(language: Language): Dictionary | undefined {
  return loaded.get(language)
}

/** The dictionary of a language, kept for {@link loadedDictionary}; the browser fetches each chunk once. */
export async function loadDictionary(language: Language): Promise<Dictionary> {
  const dictionary = await dictionaryLoaders[language]()
  loaded.set(language, dictionary)
  return dictionary
}
