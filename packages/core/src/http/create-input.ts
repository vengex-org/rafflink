import type { ResolvedConfig } from "../config.ts"
import {
  parseClaimSeconds,
  parseRules,
  type GiveawayRules,
  type RulesIssueCode,
} from "../domain/rules.ts"
import type { Parsed } from "../lib/parsed.ts"
import type { Instant } from "../ports.ts"

export type CreateConfig = Pick<
  ResolvedConfig,
  "claimKeywordMaxLength" | "defaultClaimSeconds" | "titleMaxLength" | "prizeMaxLength"
>

/** A create request that passed the boundary. */
export interface CreateGiveawayInput {
  readonly title: string
  readonly prize: string
  readonly rules: GiveawayRules
  readonly claimSeconds: number
  readonly closesAt: Instant | null
}

export type CreateIssue = {
  readonly field: string
  readonly code: RulesIssueCode | "not-a-timestamp" | "in-the-past"
}

/** The first invalid field of an untrusted create body, or the giveaway it describes. */
export function parseCreateGiveaway(
  body: unknown,
  now: Instant,
  config: CreateConfig,
): Parsed<CreateGiveawayInput, CreateIssue> {
  if (!isRecord(body)) return fail("body", "not-an-object")
  const title = parseText(body, "title", config.titleMaxLength)
  if (!title.ok) return title
  const prize = parseText(body, "prize", config.prizeMaxLength)
  if (!prize.ok) return prize
  const rules = parseRules(withKeywordNull(ownValue(body, "rules")), config)
  if (!rules.ok) return rules
  const claimSeconds = parseClaimSeconds(ownValue(body, "claimSeconds"), config)
  if (!claimSeconds.ok) return claimSeconds
  const closesAt = parseClosesAt(ownValue(body, "closesAt"), now)
  if (!closesAt.ok) return closesAt
  return {
    ok: true,
    value: {
      title: title.value,
      prize: prize.value,
      rules: rules.value,
      claimSeconds: claimSeconds.value,
      closesAt: closesAt.value,
    },
  }
}

// An empty keyword field of a form means "any message claims"; a keyword of spaces is still refused.
function withKeywordNull(rules: unknown): unknown {
  if (!isRecord(rules) || ownValue(rules, "claimKeyword") !== "") return rules
  return { ...rules, claimKeyword: null }
}

function parseText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): Parsed<string, CreateIssue> {
  const value = ownValue(body, field)
  if (value === undefined) return fail(field, "missing")
  if (typeof value !== "string") return fail(field, "not-a-string")
  const text = value.trim()
  if (text === "") return fail(field, "blank")
  return text.length > maxLength ? fail(field, "too-long") : { ok: true, value: text }
}

// A time needs an explicit zone: `2026-12-01` or `2026-12-01T10:00` would be read in the server's zone.
const zonedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

function parseClosesAt(value: unknown, now: Instant): Parsed<Instant | null, CreateIssue> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== "string" || !zonedTimestamp.test(value)) {
    return fail("closesAt", "not-a-timestamp")
  }
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return fail("closesAt", "not-a-timestamp")
  if (instant <= now) return fail("closesAt", "in-the-past")
  return { ok: true, value: instant }
}

// Own properties only: a body key like `constructor` must not read from the prototype.
function ownValue(record: unknown, key: string): unknown {
  if (!isRecord(record)) return undefined
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(field: string, code: CreateIssue["code"]): { ok: false; issue: CreateIssue } {
  return { ok: false, issue: { field, code } }
}
