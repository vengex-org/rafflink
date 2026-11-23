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
