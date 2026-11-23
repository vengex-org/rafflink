import type { ResolvedConfig } from "../config.ts"
import type { Parsed } from "../lib/parsed.ts"

/** The fields a streamer can ask a winner for after the claim; each at most once. */
export const winnerFieldKinds = ["name", "email", "address", "platform-id", "text"] as const

export type WinnerFieldKind = (typeof winnerFieldKinds)[number]

/** A winner's answers to the form, one per field it asks for. Personal data: sealed at rest, never logged. */
export type WinnerAnswers = Readonly<Partial<Record<WinnerFieldKind, string>>>

export type WinnerAnswersIssueCode =
  | "not-an-object"
  | "missing"
  | "not-a-string"
  | "blank"
  | "too-long"
  | "not-an-email"

/** The first answer that failed, named by its field kind (`answers` for the whole body). */
export interface WinnerAnswersIssue {
  readonly field: WinnerFieldKind | "answers"
  readonly code: WinnerAnswersIssueCode
}

// One @ between two parts without spaces: enough to catch a typo, the streamer's mail decides the rest.
const emailPattern = /^[^\s@]+@[^\s@]+$/

/** Parses the answers a winner sent for `form`; keys the form does not ask for are dropped, so nothing more is stored. */
export function parseWinnerAnswers(
  input: unknown,
  form: readonly WinnerFieldKind[],
  config: Pick<ResolvedConfig, "winnerAnswerMaxLength">,
): Parsed<WinnerAnswers, WinnerAnswersIssue> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("answers", "not-an-object")
  }
  const answers: Partial<Record<WinnerFieldKind, string>> = {}
  for (const kind of form) {
    const value: unknown = Object.hasOwn(input, kind) ? Reflect.get(input, kind) : undefined
    if (value === undefined || value === null) return fail(kind, "missing")
    if (typeof value !== "string") return fail(kind, "not-a-string")
    const answer = value.trim()
    if (answer === "") return fail(kind, "blank")
    if (answer.length > config.winnerAnswerMaxLength) return fail(kind, "too-long")
    if (kind === "email" && !emailPattern.test(answer)) return fail(kind, "not-an-email")
    answers[kind] = answer
  }
  return { ok: true, value: answers }
}

/** The field kind `value` names, or undefined for anything else. */
export function winnerFieldKindOf(value: unknown): WinnerFieldKind | undefined {
  return winnerFieldKinds.find((kind) => kind === value)
}

/** The known fields of `value` that hold a string, read from own keys only; for answers this code wrote, not for a winner's input. */
export function winnerAnswersOf(value: unknown): WinnerAnswers {
  const answers: Partial<Record<WinnerFieldKind, string>> = {}
  if (typeof value !== "object" || value === null) return answers
  for (const kind of winnerFieldKinds) {
    const answer: unknown = Object.hasOwn(value, kind) ? Reflect.get(value, kind) : undefined
    if (typeof answer === "string") answers[kind] = answer
  }
  return answers
}

function fail(
  field: WinnerAnswersIssue["field"],
  code: WinnerAnswersIssueCode,
): { ok: false; issue: WinnerAnswersIssue } {
  return { ok: false, issue: { field, code } }
}
