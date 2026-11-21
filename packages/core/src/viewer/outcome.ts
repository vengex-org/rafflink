import { groups } from "../domain/groups.ts"
import { ineligibleReasons, type IneligibleReason } from "../domain/rules.ts"
import type { Parsed } from "../lib/parsed.ts"
import type { EntrySummary } from "../room/rows.ts"

/** What the viewer's sign-in came to; the page shows one message per kind. */
export type CallbackOutcome =
  | { readonly kind: "entered"; readonly entry: EntrySummary }
  | { readonly kind: "already-in"; readonly entry: EntrySummary }
  | { readonly kind: "not-eligible"; readonly reason: IneligibleReason }
  | { readonly kind: "closed" }
  | { readonly kind: "rate-limited" }
  | { readonly kind: "pending"; readonly ticket: string }
  | { readonly kind: "dropped" }
  | { readonly kind: "try-again" }
  | { readonly kind: "invalid-state" }

/** An outcome that needs no further waiting: everything but `pending` and `dropped`. */
export type FinalOutcome = Exclude<CallbackOutcome, { kind: "pending" | "dropped" }>

/** Why a code could not be used yet; the code is still unused, so it may be queued. */
export type DeferCause = "rate-limited" | "unavailable"

/** Result of one pass of the entry routine. `userId` is the verified Twitch user, null when sign-in failed before that. */
export type EntryAttempt =
  | { readonly kind: "final"; readonly outcome: FinalOutcome; readonly userId: string | null }
  | { readonly kind: "deferred"; readonly cause: DeferCause }

/** Reads a stored {@link FinalOutcome}; the queue keeps it as JSON until the page polls. */
export function parseFinalOutcome(text: string): Parsed<FinalOutcome, "malformed"> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return malformed
  }
  if (!isRecord(value)) return malformed
  switch (value.kind) {
    case "closed":
    case "rate-limited":
    case "try-again":
    case "invalid-state":
      return { ok: true, value: { kind: value.kind } }
    case "entered":
    case "already-in": {
      const entry = parseEntry(value.entry)
      return entry === null ? malformed : { ok: true, value: { kind: value.kind, entry } }
    }
    case "not-eligible": {
      const reason = ineligibleReasons.find((item) => item === value.reason)
      return reason === undefined
        ? malformed
        : { ok: true, value: { kind: "not-eligible", reason } }
    }
    default:
      return malformed
  }
}

const malformed = { ok: false, issue: "malformed" } as const

function parseEntry(value: unknown): EntrySummary | null {
  if (!isRecord(value)) return null
  const group = groups.find((item) => item === value.group)
  const { tickets, enteredAt } = value
  if (group === undefined) return null
  if (typeof tickets !== "number" || !Number.isSafeInteger(tickets)) return null
  if (typeof enteredAt !== "number" || !Number.isSafeInteger(enteredAt)) return null
  return { group, tickets, enteredAt }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
