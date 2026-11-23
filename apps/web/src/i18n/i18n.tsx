import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  loadDictionary,
  loadedDictionary,
  type Dictionary,
  type MessageKey,
} from "./dictionaries.ts"
import { en } from "./en.ts"
import { initialLanguage, storeLanguage, type Language } from "./language.ts"

export type PluralBase =
  | "ticket"
  | "minute"
  | "day"
  | "year"
  | "recentGiveaways"
  | "recentDays"
  | "entered"
  | "usageLow"
  | "roleFailures"
  | "chatFailures"
  | "drawBatch"
  | "winners"

type PluralForm = "one" | "few" | "many" | "other"
type Params = Readonly<Record<string, string | number>>

/** Everything a component needs to speak the chosen language: texts, plurals and locale-aware numbers and times. */
export interface I18n {
  readonly language: Language
  setLanguage(language: Language): void
  t(key: MessageKey, params?: Params): string
  /** Like `t`, with React nodes (a bold word) in place of the `{name}` markers. */
  rich(key: MessageKey, nodes: Readonly<Record<string, ReactNode>>): ReactNode
  /** The `base` text for `count`; `{count}` is the formatted number. */
  plural(base: PluralBase, count: number, params?: Params): string
  number(value: number): string
  /** One digit after the decimal separator. */
  decimal(value: number): string
  dateTime(ms: number): string
  date(ms: number): string
  time(ms: number): string
}

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [shown, setShown] = useState(firstShown)
  const value = useMemo(
    () =>
      createI18n(shown.language, shown.dictionary, (next) => {
        storeLanguage(next)
        loadDictionary(next).then(
          (dictionary) => setShown({ language: next, dictionary }),
          (error: unknown) => console.error("dictionary failed to load", { language: next, error }),
        )
      }),
    [shown],
  )
  const { language } = shown
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  return <I18nContext value={value}>{children}</I18nContext>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (value === null) throw new Error("useI18n needs an I18nProvider")
  return value
}

const I18nContext = createContext<I18n | null>(null)

interface Shown {
  readonly language: Language
  readonly dictionary: Dictionary
}

/** The wanted language when `main.tsx` loaded its dictionary before the first render, else English, which needs no loading. */
function firstShown(): Shown {
  const language = initialLanguage()
  const dictionary = loadedDictionary(language)
  return dictionary === undefined ? { language: "en", dictionary: en } : { language, dictionary }
}

function createI18n(
  language: Language,
  dictionary: Dictionary,
  setLanguage: (language: Language) => void,
): I18n {
  const numbers = new Intl.NumberFormat(language)
  const decimals = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const dateTimes = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium" })
  const times = new Intl.DateTimeFormat(language, { timeStyle: "short" })
  const rules = new Intl.PluralRules(language)

  const t = (key: MessageKey, params: Params = {}) => fill(dictionary[key], params)
  return {
    language,
    setLanguage,
    t,
    rich: (key, nodes) => richParts(dictionary[key], nodes),
    plural: (base, count, params = {}) =>
      t(`${base}.${pluralForm(rules.select(count))}`, { ...params, count: numbers.format(count) }),
    number: (value) => numbers.format(value),
    decimal: (value) => decimals.format(value),
    dateTime: (ms) => dateTimes.format(ms),
    date: (ms) => dates.format(ms),
    time: (ms) => times.format(ms),
  }
}

const markers = /(\{\w+\})/

function markerName(part: string): string | null {
  return part.startsWith("{") && part.endsWith("}") ? part.slice(1, -1) : null
}

/** The template with every `{name}` marker replaced by its value in `params`; a missing value throws. */
export function fill(template: string, params: Params): string {
  return template
    .split(markers)
    .map((part) => {
      const name = markerName(part)
      if (name === null) return part
      const value = params[name]
      if (value === undefined) throw new Error(`message has no value for {${name}}`)
      return String(value)
    })
    .join("")
}

/** The template as React nodes, with every `{name}` marker replaced by its node in `nodes`. */
export function richParts(template: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode {
  return template.split(markers).map((part, index) => {
    const name = markerName(part)
    return <Fragment key={index}>{name === null ? part : nodes[name]}</Fragment>
  })
}

/** The plural key suffix for a CLDR category of `Intl.PluralRules`. */
export function pluralForm(rule: Intl.LDMLPluralRule): PluralForm {
  switch (rule) {
    case "one":
      return "one"
    case "few":
      return "few"
    case "many":
      return "many"
    // None of the languages uses `zero` or `two`.
    case "zero":
    case "two":
    case "other":
      return "other"
  }
}
