import type { ResolvedConfig } from "../config.ts"
import type { Parsed } from "../lib/parsed.ts"
import { bestGroup, groups, type Group, type Tickets } from "./groups.ts"

/** What a streamer sets for who may enter and with how many tickets. */
export interface GiveawayRules {
  readonly tickets: Tickets
  readonly subsOnly: boolean
  readonly followersOnly: boolean
  /** Null means no minimum. */
  readonly minAccountAgeDays: number | null
  /** Null means any chat message from a winner claims. */
  readonly claimKeyword: string | null
}

/** What Twitch told us about a viewer, gathered by the caller before the check. */
export interface ViewerFacts {
  readonly userId: string
  readonly isFollower: boolean
  /** Null when not subscribed. */
  readonly subTier: 1 | 2 | 3 | null
  readonly isVip: boolean
  readonly isModerator: boolean
  /** Null when unknown; an unknown age fails a minimum. */
  readonly accountAgeDays: number | null
}

export const ineligibleReasons = [
  "broadcaster",
  "subs-only",
  "followers-only",
  "account-too-young",
  "no-tickets",
] as const

export type IneligibleReason = (typeof ineligibleReasons)[number]

/** Whether a viewer may enter; when they may, the group and the tickets (always above 0) they enter with. */
export type EligibilityOutcome =
  | { eligible: true; group: Group; tickets: number }
  | { eligible: false; reason: IneligibleReason }

export type RulesIssueCode =
  | "not-an-object"
  | "missing"
  | "not-a-boolean"
  | "not-a-string"
  | "not-a-non-negative-integer"
  | "not-a-positive-integer"
  | "blank"
  | "too-long"
  | "too-large"

/** The first invalid field of untrusted input, as a path like `tickets.vip`. */
export interface RulesIssue {
  readonly field: string
  readonly code: RulesIssueCode
}

export function evaluateEligibility(
  rules: GiveawayRules,
  viewer: ViewerFacts,
  broadcasterId: string,
): EligibilityOutcome {
  if (viewer.userId === broadcasterId) return { eligible: false, reason: "broadcaster" }
  if (rules.subsOnly && viewer.subTier === null) return { eligible: false, reason: "subs-only" }
  if (rules.followersOnly && !viewer.isFollower) {
    return { eligible: false, reason: "followers-only" }
  }
  if (
    rules.minAccountAgeDays !== null
    && (viewer.accountAgeDays === null || viewer.accountAgeDays < rules.minAccountAgeDays)
  ) {
    return { eligible: false, reason: "account-too-young" }
  }
  const best = bestGroup(rules.tickets, memberGroups(viewer))
  if (best.tickets === 0) return { eligible: false, reason: "no-tickets" }
  return { eligible: true, group: best.group, tickets: best.tickets }
}

/** Parses `rules_json` or a create request body; nothing past this takes unchecked rules. */
export function parseRules(
  input: unknown,
  config: Pick<ResolvedConfig, "claimKeywordMaxLength" | "ticketsPerGroupMax">,
): Parsed<GiveawayRules, RulesIssue> {
  if (!isRecord(input)) return fail("rules", "not-an-object")
  const tickets = parseTickets(ownValue(input, "tickets"), config.ticketsPerGroupMax)
  if (!tickets.ok) return tickets
  const subsOnly = parseFlag(input, "subsOnly")
  if (!subsOnly.ok) return subsOnly
  const followersOnly = parseFlag(input, "followersOnly")
  if (!followersOnly.ok) return followersOnly
  const minAccountAgeDays = parseMinAccountAgeDays(input)
  if (!minAccountAgeDays.ok) return minAccountAgeDays
  const claimKeyword = parseClaimKeyword(input, config.claimKeywordMaxLength)
  if (!claimKeyword.ok) return claimKeyword
  return ok({
    tickets: tickets.value,
    subsOnly: subsOnly.value,
    followersOnly: followersOnly.value,
    minAccountAgeDays: minAccountAgeDays.value,
    claimKeyword: claimKeyword.value,
  })
}

/** An absent claim time takes the configured default; a present one must be a positive integer up to the maximum. */
export function parseClaimSeconds(
  input: unknown,
  config: Pick<ResolvedConfig, "defaultClaimSeconds" | "claimSecondsMax">,
): Parsed<number, RulesIssue> {
  if (input === undefined) return ok(config.defaultClaimSeconds)
  if (!isPositiveInteger(input)) return fail("claimSeconds", "not-a-positive-integer")
  if (input > config.claimSecondsMax) return fail("claimSeconds", "too-large")
  return ok(input)
}

function memberGroups(viewer: ViewerFacts): Group[] {
  const member: Group[] = ["viewer"]
  if (viewer.isFollower) member.push("follower")
  if (viewer.subTier !== null) member.push(`sub_t${viewer.subTier}`)
  if (viewer.isVip) member.push("vip")
  if (viewer.isModerator) member.push("moderator")
  return member
}

function parseTickets(input: unknown, max: number): Parsed<Tickets, RulesIssue> {
  if (!isRecord(input)) return fail("tickets", "not-an-object")
  const counts: Record<Group, number> = {
    viewer: 0,
    follower: 0,
    sub_t1: 0,
    sub_t2: 0,
    sub_t3: 0,
    vip: 0,
    moderator: 0,
  }
  for (const group of groups) {
    const count = ownValue(input, group)
    if (count === undefined) return fail(`tickets.${group}`, "missing")
    if (!isNonNegativeInteger(count)) {
      return fail(`tickets.${group}`, "not-a-non-negative-integer")
    }
    if (count > max) return fail(`tickets.${group}`, "too-large")
    counts[group] = count
  }
  return ok(counts)
}

function parseFlag(input: Record<string, unknown>, field: string): Parsed<boolean, RulesIssue> {
  const value = ownValue(input, field)
  if (value === undefined) return ok(false)
  if (typeof value !== "boolean") return fail(field, "not-a-boolean")
  return ok(value)
}

function parseMinAccountAgeDays(input: Record<string, unknown>): Parsed<number | null, RulesIssue> {
  const value = ownValue(input, "minAccountAgeDays")
  if (value === undefined || value === null) return ok(null)
  if (!isNonNegativeInteger(value)) return fail("minAccountAgeDays", "not-a-non-negative-integer")
  return ok(value === 0 ? null : value)
}

function parseClaimKeyword(
  input: Record<string, unknown>,
  maxLength: number,
): Parsed<string | null, RulesIssue> {
  const value = ownValue(input, "claimKeyword")
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== "string") return fail("claimKeyword", "not-a-string")
  const keyword = value.trim()
  if (keyword === "") return fail("claimKeyword", "blank")
  if (keyword.length > maxLength) return fail("claimKeyword", "too-long")
  return ok(keyword)
}

// Own properties only: a lookup by group or field name must not reach `constructor` or `__proto__`.
function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0
}

function ok<T>(value: T): Parsed<T, RulesIssue> {
  return { ok: true, value }
}

function fail(field: string, code: RulesIssueCode): { ok: false; issue: RulesIssue } {
  return { ok: false, issue: { field, code } }
}
