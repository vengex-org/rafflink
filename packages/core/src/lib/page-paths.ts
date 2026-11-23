import { languages, sourceLanguage, type Language } from "./languages.ts"

/** The path of a giveaway's public page. */
export function giveawayPath(code: string): string {
  return `/${encodeURIComponent(code)}`
}

/** The path of the page that checks a giveaway's draw. */
export function verifyPath(code: string): string {
  return `${giveawayPath(code)}/verify`
}

/** The draw from a pasted list, which needs no account. */
export const drawPath = "/draw"

/** Where a moderator link points; the link's token follows after `#`, so it never reaches a server log. */
export const moderatorOpenPath = "/mod"

/** The live page of a moderator link, which its cookie opens. */
export function moderatorLivePath(id: string): string {
  return `${moderatorOpenPath}/${encodeURIComponent(id)}`
}

/** Why a moderator's sign-in sent the browser back to {@link moderatorOpenPath} instead of the moderator page. */
export const moderatorSignInOutcomes = [
  "cancelled",
  "invalid-state",
  "link-invalid",
  "not-a-moderator",
  "try-again",
] as const

export type ModeratorSignInOutcome = (typeof moderatorSignInOutcomes)[number]

/** {@link moderatorOpenPath} with the outcome of a moderator's sign-in in `?moderator=`. */
export function moderatorOutcomePath(outcome: ModeratorSignInOutcome): string {
  return `${moderatorOpenPath}?moderator=${outcome}`
}

/** A streamer's public history page; the login is the platform's, in lower case. */
export function historyPath(platform: string, login: string): string {
  return `/s/${encodeURIComponent(platform)}/${encodeURIComponent(login)}`
}

/** The id of the JSON element in which the server hands a history page the answer of its `/api` request, so the page makes none. */
export const historyDataElementId = "history-data"

/** The pages served in every language, with the language in the address. */
export const localizedPages = ["home", "privacy", "terms"] as const

export type LocalizedPage = (typeof localizedPages)[number]

/** A localized page in one of its languages. */
export interface LocalizedAddress {
  readonly language: Language
  readonly page: LocalizedPage
}

/** The address of `page` in `language`: `/` and `/privacy` in the source language, `/de/` and `/de/privacy` in the others. */
export function localizedPath(language: Language, page: LocalizedPage): string {
  const prefix = language === sourceLanguage ? "" : `/${language}`
  return page === "home" ? `${prefix}/` : `${prefix}/${page}`
}

/** The localized page at `pathname`, with or without a trailing slash; null for every other address, `/DE/` and `/en/` included. */
export function pageOfPath(pathname: string): LocalizedAddress | null {
  return addresses.get(withoutTrailingSlash(pathname)) ?? null
}

/** The build file that holds the rendered page, relative to the build's root; `index.html` stays the app's empty shell. */
export function prerenderFile(language: Language, page: LocalizedPage): string {
  const folder = language === sourceLanguage ? "" : `${language}/`
  if (page !== "home") return `${folder}${page}.html`
  return language === sourceLanguage ? "home.html" : `${folder}index.html`
}

/** The address a static host serves a build file at: `de/index.html` at `/de/`, `de/privacy.html` at `/de/privacy`. */
export function servedPath(file: string): string {
  if (file === "index.html" || file.endsWith("/index.html")) {
    return `/${file.slice(0, -"index.html".length)}`
  }
  return `/${file.replace(/\.html$/, "")}`
}

/** The build file in which the web build lists the pages it prerendered, so a server answers each address with its file. */
export const prerenderManifestFile = "prerendered.json"

/** A page the web build prerendered: its address and its file relative to the build's root. */
export interface PrerenderedPage {
  readonly path: string
  readonly file: string
}

/** The text of {@link prerenderManifestFile} for `pages`. */
export function prerenderManifest(pages: readonly PrerenderedPage[]): string {
  return JSON.stringify(Object.fromEntries(pages.map(({ path, file }) => [path, file])))
}

/**
 * The file of each prerendered address in a {@link prerenderManifestFile} text. A text that is no manifest lists
 * none: a build without PUBLIC_URL writes no manifest, and a host may answer the missing file with the app shell.
 */
export function parsePrerenderManifest(text: string): ReadonlyMap<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (typeof parsed !== "object" || parsed === null) return new Map()
  return new Map(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

/** The id of the JSON element in which a prerendered legal page carries the operator it was built with. */
export const legalDataElementId = "legal-data"

/** The hreflang alternates of `page`: one per language, and `x-default` for the source language. */
export function alternates(
  page: LocalizedPage,
): readonly { readonly hreflang: Language | "x-default"; readonly path: string }[] {
  return [
    ...languages.map((language) => ({ hreflang: language, path: localizedPath(language, page) })),
    { hreflang: "x-default", path: localizedPath(sourceLanguage, page) },
  ]
}

const addresses = new Map<string, LocalizedAddress>(
  languages.flatMap((language) =>
    localizedPages.map((page) => [
      withoutTrailingSlash(localizedPath(language, page)),
      { language, page },
    ]),
  ),
)

function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, "")
}
