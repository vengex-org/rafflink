import type { ResolvedConfig } from "../config.ts"
import type { Parsed } from "../lib/parsed.ts"
import type { PlatformCapabilities } from "../platform/provider.ts"
import type { Instant } from "../ports.ts"
import { bestGroup, groups, supportedGroups, type Group, type Tickets } from "./groups.ts"
import { winnerFieldKinds, type WinnerFieldKind } from "./winner-form.ts"

const msPerDay = 86_400_000
/** The highest minimum age to win a streamer can state: a bound on typos, since no giveaway asks winners to be 100 or older. */
export const minAgeMax = 99

/** What a streamer sets for who may enter and with how many tickets. */
export interface GiveawayRules {
  readonly tickets: Tickets
  readonly subsOnly: boolean
  readonly followersOnly: boolean
  /** Null means no minimum. */
  readonly minAccountAgeDays: number | null
  /** Null means any chat message from a winner claims. */
  readonly claimKeyword: string | null
  /** Null lets winners of the streamer's earlier giveaways enter. */
  readonly excludeRecentWinners: RecentWinnersRule | null
  /** A chat message starting with it enters the chatter while entries are open; null means no chat entry. */
  readonly chatKeyword: string | null
  /** Viewers enter by signing in on the giveaway page; false only with a chat keyword (chat only). */
  readonly pageEntry: boolean
  /** The age in years a winner must have reached, shown in the giveaway's rules; Rafflink cannot check it. Null means none stated. */
  readonly minAge: number | null
  /** Places whose residents cannot win, as the streamer wrote them; Rafflink cannot check it. Null means none. */
  readonly excludedCountries: string | null
  /** The streamer's own terms, shown as written under the generated rules; null when there are none. */
  readonly extraTerms: string | null
  /** What the winner fills in on the giveaway page after the claim, in this order; empty means no form. */
  readonly winnerForm: readonly WinnerFieldKind[]
}

/** Keeps out the winners of the streamer's last `count` drawn giveaways, or of those drawn in the last `count` days. */
export interface RecentWinnersRule {
  readonly kind: (typeof recentWinnersKinds)[number]
  readonly count: number
}

export const recentWinnersKinds = ["giveaways", "days"] as const

/** The rule settings {@link parseRules} bounds untrusted rules with. */
export type RulesConfig = Pick<
  ResolvedConfig,
  | "claimKeywordMaxLength"
  | "ticketsPerGroupMax"
  | "recentWinnersGiveawaysMax"
  | "recentWinnersDaysMax"
  | "excludedCountriesMaxLength"
  | "extraTermsMaxLength"
>

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
  /** Why the streamer keeps this account out of the giveaway; null when nothing does. */
  readonly exclusion: Exclusion | null
}

/** A reason the account itself may not enter, whatever the rules: on the streamer's block list (or a known chat bot), or a recent winner. */
export type Exclusion = Extract<IneligibleReason, "blocked" | "recent-winner">

export const ineligibleReasons = [
  "broadcaster",
  "blocked",
  "recent-winner",
  "subs-only",
  "followers-only",
  "account-too-young",
  "no-tickets",
  // The giveaway takes chat entries only; the room refuses a page entry before any rule is read.
  "page-entry-off",
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
  | "unknown-kind"
  | "not-a-list"
  | "duplicate"
  /** Page entry is off and no chat keyword is set, so nobody could enter. */
  | "no-entry-way"
  /** The giveaway's platform cannot check the rule, so it would hand out the wrong tickets. */
  | "unsupported"

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
  if (viewer.exclusion !== null) return { eligible: false, reason: viewer.exclusion }
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
export function parseRules(input: unknown, config: RulesConfig): Parsed<GiveawayRules, RulesIssue> {
  if (!isRecord(input)) return fail("rules", "not-an-object")
  const tickets = parseTickets(ownValue(input, "tickets"), config.ticketsPerGroupMax)
  if (!tickets.ok) return tickets
  const subsOnly = parseFlag(input, "subsOnly")
  if (!subsOnly.ok) return subsOnly
  const followersOnly = parseFlag(input, "followersOnly")
  if (!followersOnly.ok) return followersOnly
  const minAccountAgeDays = parseMinAccountAgeDays(input)
  if (!minAccountAgeDays.ok) return minAccountAgeDays
  const claimKeyword = parseText(input, "claimKeyword", config.claimKeywordMaxLength)
  if (!claimKeyword.ok) return claimKeyword
  const excludeRecentWinners = parseRecentWinners(input, config)
  if (!excludeRecentWinners.ok) return excludeRecentWinners
  const chatKeyword = parseText(input, "chatKeyword", config.claimKeywordMaxLength)
  if (!chatKeyword.ok) return chatKeyword
  const pageEntry = parseFlag(input, "pageEntry", true)
  if (!pageEntry.ok) return pageEntry
  if (!pageEntry.value && chatKeyword.value === null) return fail("pageEntry", "no-entry-way")
  const minAge = parseMinAge(input)
  if (!minAge.ok) return minAge
  const excludedCountries = parseText(input, "excludedCountries", config.excludedCountriesMaxLength)
  if (!excludedCountries.ok) return excludedCountries
  const extraTerms = parseText(input, "extraTerms", config.extraTermsMaxLength)
  if (!extraTerms.ok) return extraTerms
  const winnerForm = parseWinnerForm(ownValue(input, "winnerForm"))
  if (!winnerForm.ok) return winnerForm
  return ok({
    tickets: tickets.value,
    subsOnly: subsOnly.value,
    followersOnly: followersOnly.value,
    minAccountAgeDays: minAccountAgeDays.value,
    claimKeyword: claimKeyword.value,
    excludeRecentWinners: excludeRecentWinners.value,
    chatKeyword: chatKeyword.value,
    pageEntry: pageEntry.value,
    minAge: minAge.value,
    excludedCountries: excludedCountries.value,
    extraTerms: extraTerms.value,
    winnerForm: winnerForm.value,
  })
}

/** The first rule the platform cannot check, or null; a group the platform cannot tell must get 0 tickets. */
export function unsupportedRule(
  rules: GiveawayRules,
  capabilities: PlatformCapabilities,
): RulesIssue | null {
  if (rules.subsOnly && !capabilities.subTiers) return unsupported("subsOnly")
  if (rules.followersOnly && !capabilities.followerCheck) return unsupported("followersOnly")
  if (rules.minAccountAgeDays !== null && !capabilities.accountAge) {
    return unsupported("minAccountAgeDays")
  }
  const supported = supportedGroups(capabilities)
  const untold = groups.find((group) => !supported.includes(group) && rules.tickets[group] > 0)
  if (untold !== undefined) return unsupported(`tickets.${untold}`)
  if (rules.pageEntry && !capabilities.pageEntry) return unsupported("pageEntry")
  if (rules.chatKeyword !== null && !capabilities.chatEntry) return unsupported("chatKeyword")
  return null
}

/** Whole days since the account was created; never negative, so a clock ahead of the platform's does not make an account younger than new. */
export function accountAgeDays(now: Instant, createdAt: Instant): number {
  return Math.max(0, Math.floor((now - createdAt) / msPerDay))
}

/** Whether a chat message asks to enter: its text starts with the keyword as a whole word, in any letter case. */
export function isEntryMessage(text: string, keyword: string): boolean {
  const message = text.trim().toLowerCase()
  const wanted = keyword.toLowerCase()
  return message === wanted || message.startsWith(`${wanted} `)
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

function parseFlag(
  input: Record<string, unknown>,
  field: string,
  absent = false,
): Parsed<boolean, RulesIssue> {
  const value = ownValue(input, field)
  if (value === undefined) return ok(absent)
  if (typeof value !== "boolean") return fail(field, "not-a-boolean")
  return ok(value)
}

function parseMinAccountAgeDays(input: Record<string, unknown>): Parsed<number | null, RulesIssue> {
  const value = ownValue(input, "minAccountAgeDays")
  if (value === undefined || value === null) return ok(null)
  if (!isNonNegativeInteger(value)) return fail("minAccountAgeDays", "not-a-non-negative-integer")
  return ok(value === 0 ? null : value)
}

function parseMinAge(input: Record<string, unknown>): Parsed<number | null, RulesIssue> {
  const value = ownValue(input, "minAge")
  if (value === undefined || value === null) return ok(null)
  if (!isPositiveInteger(value)) return fail("minAge", "not-a-positive-integer")
  if (value > minAgeMax) return fail("minAge", "too-large")
  return ok(value)
}

function parseText(
  input: Record<string, unknown>,
  field: "claimKeyword" | "chatKeyword" | "excludedCountries" | "extraTerms",
  maxLength: number,
): Parsed<string | null, RulesIssue> {
  const value = ownValue(input, field)
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== "string") return fail(field, "not-a-string")
  const text = value.trim()
  if (text === "") return fail(field, "blank")
  if (text.length > maxLength) return fail(field, "too-long")
  return ok(text)
}

function parseRecentWinners(
  input: Record<string, unknown>,
  config: RulesConfig,
): Parsed<RecentWinnersRule | null, RulesIssue> {
  const value = ownValue(input, "excludeRecentWinners")
  if (value === undefined || value === null) return ok(null)
  if (!isRecord(value)) return fail("excludeRecentWinners", "not-an-object")
  const kindValue = ownValue(value, "kind")
  const kind = recentWinnersKinds.find((item) => item === kindValue)
  if (kind === undefined) return fail("excludeRecentWinners.kind", "unknown-kind")
  const count = ownValue(value, "count")
  if (!isPositiveInteger(count)) return fail("excludeRecentWinners.count", "not-a-positive-integer")
  const max: Readonly<Record<RecentWinnersRule["kind"], number>> = {
    giveaways: config.recentWinnersGiveawaysMax,
    days: config.recentWinnersDaysMax,
  }
  if (count > max[kind]) return fail("excludeRecentWinners.count", "too-large")
  return ok({ kind, count })
}

// Absent means no form: rules saved before the winner form existed have none.
function parseWinnerForm(value: unknown): Parsed<readonly WinnerFieldKind[], RulesIssue> {
  if (value === undefined) return ok([])
  if (!Array.isArray(value)) return fail("winnerForm", "not-a-list")
  const fields: WinnerFieldKind[] = []
  for (const [index, item] of value.entries()) {
    const kind = winnerFieldKinds.find((candidate) => candidate === item)
    if (kind === undefined) return fail(`winnerForm.${index}`, "unknown-kind")
    if (fields.includes(kind)) return fail(`winnerForm.${index}`, "duplicate")
    fields.push(kind)
  }
  return ok(fields)
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

function unsupported(field: string): RulesIssue {
  return { field, code: "unsupported" }
}

function ok<T>(value: T): Parsed<T, RulesIssue> {
  return { ok: true, value }
}

function fail(field: string, code: RulesIssueCode): { ok: false; issue: RulesIssue } {
  return { ok: false, issue: { field, code } }
}
