import { cs } from "./cs.ts"
import { en, type MessageKey } from "./en.ts"
import type { Language } from "./language.ts"
import { sk } from "./sk.ts"

export type { MessageKey }

export const dictionaries: Readonly<Record<Language, Readonly<Record<MessageKey, string>>>> = {
  en,
  sk,
  cs,
}
