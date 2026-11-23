import { groups, supportedGroups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import {
  badgesSeen,
  channelEntryVias,
  minAgeMax,
  type ChannelEntryVia,
  type GiveawayRules,
  type PointsReward,
  type RecentWinnersRule,
} from "@rafflink/core/domain/rules"
import type { WinnerFieldKind } from "@rafflink/core/domain/winner-form"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { PlatformCapabilities } from "@rafflink/core/platform/provider"
import type { CreateGiveawayBody } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { ticketOdds, type Odds } from "../lib/rules-text.ts"

export type Step = 1 | 2 | 3
export type Audience = "everyone" | "followers" | "subscribers"
export type Ending = "never" | "at-time"
export type RecentWinners = "off" | RecentWinnersRule["kind"]
/** Where viewers enter: on the giveaway page, by the chat keyword, or both. */
export type EntryWays = "page" | "page-and-chat" | "chat"

/** The chat keyword the wizard offers until the streamer types another. */
export const defaultChatKeyword = "!enter"

/** The claim times offered as buttons, in seconds. */
export const claimPresets = [120, 300, 600] as const

export type ClaimPreset = (typeof claimPresets)[number]

/**
 * The claim time as answered: a preset, or whole minutes typed by hand. Minutes are fine enough for
 * a claim window; a value that is not whole minutes (an older giveaway) shows as a fraction to fix.
 * The upper bound is the server's `CLAIM_SECONDS_MAX`, so its complaint is shown under the field.
 */
export type ClaimTime =
  | { readonly kind: "preset"; readonly seconds: ClaimPreset }
  | { readonly kind: "custom"; readonly minutes: string }

export interface Values {
  title: string
  prize: string
  audience: Audience
  tickets: Record<Group, string>
  minAccountAgeDays: string
  ending: Ending
  closesAt: string
  claim: ClaimTime
  claimKeyword: string
  recentWinners: RecentWinners
  /** The count of the recent-winners rule; kept while the rule is off so switching it on again shows it. */
  recentWinnersCount: string
  entryWays: EntryWays
  chatKeyword: string
  /** Subs, resubs and gift subs received enter by themselves; page or chat entry stays on beside it. */
  subEntry: boolean
  /** The channel point reward whose redemption enters; null for none. */
  pointsReward: PointsReward | null
  winnerCount: string
  /** The official rules fields; empty when not stated. */
  minAge: string
  excludedCountries: string
  extraTerms: string
  winnerForm: readonly WinnerFieldKind[]
}

export interface Issue {
  readonly field: string
  readonly message: MessageKey
}

export const initialValues: Values = {
  title: "",
  prize: "",
  audience: "everyone",
  tickets: {
    viewer: "1",
    follower: "1",
    sub_t1: "1",
    sub_t2: "1",
    sub_t3: "1",
    member: "0",
    vip: "1",
    moderator: "1",
  },
  minAccountAgeDays: "",
  ending: "never",
  closesAt: "",
  claim: { kind: "preset", seconds: 300 },
  claimKeyword: "",
  recentWinners: "off",
  recentWinnersCount: "3",
  entryWays: "page",
  chatKeyword: defaultChatKeyword,
  subEntry: false,
  pointsReward: null,
  winnerCount: "1",
  minAge: "",
  excludedCountries: "",
  extraTerms: "",
  winnerForm: [],
}

/**
 * The answers as the platform can check them: a group it cannot tell gets 0 tickets, and a filter or entry way it
 * lacks falls back to one it has. The wizard hides those controls, so an answer kept from elsewhere never reaches the server.
 */
export function fitValues(values: Values, capabilities: PlatformCapabilities): Values {
  const fitted: Values = {
    ...values,
    audience: audienceOffered(values.audience, capabilities) ? values.audience : "everyone",
    minAccountAgeDays: capabilities.accountAge ? values.minAccountAgeDays : "",
    entryWays: fitEntryWays(values.entryWays, capabilities),
    subEntry: capabilities.subEntry && values.subEntry,
    pointsReward: capabilities.pointsEntry ? values.pointsReward : null,
  }
  const supported = ticketGroups(fitted, capabilities)
  const tickets = { ...values.tickets }
  for (const group of groups) if (!supported.includes(group)) tickets[group] = "0"
  return { ...fitted, tickets }
}

/** The ticket groups the platform can tell for these answers: its chat badge groups only when every entrant comes by chat or a sub. */
export function ticketGroups(values: Values, capabilities: PlatformCapabilities): readonly Group[] {
  return supportedGroups(
    capabilities,
    badgesSeen({ pageEntry: values.entryWays !== "chat", pointsReward: values.pointsReward }),
  )
}

export function audienceOffered(audience: Audience, capabilities: PlatformCapabilities): boolean {
  switch (audience) {
    case "everyone":
      return true
    case "followers":
      return capabilities.followerCheck
    case "subscribers":
      return capabilities.subTiers
  }
}

export function entryWaysOffered(ways: EntryWays, capabilities: PlatformCapabilities): boolean {
  switch (ways) {
    case "page":
      return capabilities.pageEntry
    case "page-and-chat":
      return capabilities.pageEntry && capabilities.chatEntry
    case "chat":
      return capabilities.chatEntry
  }
}

/** The answers that start a new giveaway like `giveaway`; entries end when the streamer closes them. */
export function valuesFrom(giveaway: DashboardGiveaway): Values {
  const { rules } = giveaway
  return {
    ...initialValues,
    title: giveaway.title ?? "",
    prize: giveaway.prize ?? "",
    audience: rules.subsOnly ? "subscribers" : rules.followersOnly ? "followers" : "everyone",
    tickets: {
      viewer: String(rules.tickets.viewer),
      follower: String(rules.tickets.follower),
      sub_t1: String(rules.tickets.sub_t1),
      sub_t2: String(rules.tickets.sub_t2),
      sub_t3: String(rules.tickets.sub_t3),
      member: String(rules.tickets.member),
      vip: String(rules.tickets.vip),
      moderator: String(rules.tickets.moderator),
    },
    minAccountAgeDays: rules.minAccountAgeDays === null ? "" : String(rules.minAccountAgeDays),
    claim: claimOf(giveaway.claimSeconds),
    claimKeyword: rules.claimKeyword ?? "",
    recentWinners: rules.excludeRecentWinners?.kind ?? "off",
    recentWinnersCount:
      rules.excludeRecentWinners === null
        ? initialValues.recentWinnersCount
        : String(rules.excludeRecentWinners.count),
    entryWays: entryWaysOf(rules),
    chatKeyword: rules.chatKeyword ?? defaultChatKeyword,
    subEntry: rules.subEntry,
    pointsReward: rules.pointsReward,
    minAge: rules.minAge === null ? "" : String(rules.minAge),
    excludedCountries: rules.excludedCountries ?? "",
    extraTerms: rules.extraTerms ?? "",
    winnerForm: rules.winnerForm,
  }
}

/**
 * The sub and points entry the answers turn on whose scopes the token lacks; the server refuses such a giveaway.
 * Chat entry works without its scope (every chatter counts as not following), so it never blocks.
 */
export function missingEntryScopes(
  values: Values,
  ready: readonly ChannelEntryVia[],
): readonly ChannelEntryVia[] {
  const used: Readonly<Record<ChannelEntryVia, boolean>> = {
    chat: false,
    sub: values.subEntry,
    points: values.pointsReward !== null,
  }
  return channelEntryVias.filter((way) => used[way] && !ready.includes(way))
}

/** The first thing wrong with the answers of one step, or null; the server checks everything again. */
export function stepIssue(step: Step, values: Values, now: number): Issue | null {
  switch (step) {
    case 1: {
      const age = values.minAge.trim()
      if (age !== "" && (!isWholeNumber(age) || Number(age) < 1 || Number(age) > minAgeMax)) {
        return { field: "minAge", message: "issue.wholeYears" }
      }
      if (values.ending === "never") return null
      const end = new Date(values.closesAt).getTime()
      if (Number.isNaN(end)) {
        return { field: "closesAt", message: "issue.pickEnd" }
      }
      return end > now ? null : { field: "closesAt", message: "issue.future" }
    }
    case 2: {
      for (const group of groups) {
        if (!isWholeNumber(values.tickets[group])) {
          return { field: `tickets.${group}`, message: "issue.not-a-non-negative-integer" }
        }
      }
      if (values.minAccountAgeDays.trim() !== "" && !isWholeNumber(values.minAccountAgeDays)) {
        return {
          field: "minAccountAgeDays",
          message: "issue.wholeDays",
        }
      }
      if (
        values.recentWinners !== "off"
        && (!isWholeNumber(values.recentWinnersCount) || Number(values.recentWinnersCount) < 1)
      ) {
        return { field: "excludeRecentWinners.count", message: "issue.not-a-positive-integer" }
      }
      if (!isWholeNumber(values.winnerCount) || Number(values.winnerCount) < 1) {
        return { field: "winnerCount", message: "issue.not-a-positive-integer" }
      }
      if (
        values.claim.kind === "custom"
        && (!isWholeNumber(values.claim.minutes) || Number(values.claim.minutes) < 1)
      ) {
        return { field: "claimSeconds", message: "issue.wholeMinutes" }
      }
      return null
    }
    case 3:
      return null
  }
}

/** Which step asks for the field the server complained about; the review step for a field no step owns. */
export function stepOfField(field: string): Step {
  if (
    field === "title"
    || field === "prize"
    || field === "closesAt"
    || field === "minAge"
    || field === "excludedCountries"
    || field === "extraTerms"
  ) {
    return 1
  }
  if (
    field.startsWith("tickets.")
    || field === "minAccountAgeDays"
    || field === "claimSeconds"
    || field === "claimKeyword"
    || field === "chatKeyword"
    || field === "subEntry"
    || field === "winnerCount"
    || field.startsWith("winnerForm")
    || field.startsWith("excludeRecentWinners")
  ) {
    return 2
  }
  return 3
}

/** The odds the ticket counts of the `shown` groups give, or null while a count is not a whole number. */
export function oddsOf(typed: Values["tickets"], shown: readonly Group[]): Odds | null {
  if (!shown.every((group) => isWholeNumber(typed[group]))) return null
  return ticketOdds(ticketCounts(typed), shown)
}

export function toBody(values: Values): CreateGiveawayBody {
  return {
    title: values.title,
    prize: values.prize,
    rules: {
      tickets: ticketCounts(values.tickets),
      subsOnly: values.audience === "subscribers",
      followersOnly: values.audience === "followers",
      minAccountAgeDays:
        values.minAccountAgeDays.trim() === "" ? undefined : Number(values.minAccountAgeDays),
      claimKeyword: values.claimKeyword,
      excludeRecentWinners:
        values.recentWinners === "off"
          ? null
          : { kind: values.recentWinners, count: Number(values.recentWinnersCount) },
      chatKeyword: values.entryWays === "page" ? null : values.chatKeyword,
      pageEntry: values.entryWays !== "chat",
      subEntry: values.subEntry,
      pointsReward: values.pointsReward,
      minAge: values.minAge.trim() === "" ? null : Number(values.minAge),
      excludedCountries: textOrNull(values.excludedCountries),
      extraTerms: textOrNull(values.extraTerms),
      winnerForm: values.winnerForm,
    },
    closesAt: values.ending === "at-time" ? instantOf(values.closesAt) : undefined,
    claimSeconds: claimSecondsOf(values.claim),
    winnerCount: Number(values.winnerCount),
  }
}

/** A preset when `seconds` is one, else the custom minutes. */
export function claimOf(seconds: number): ClaimTime {
  const preset = claimPresets.find((candidate) => candidate === seconds)
  return preset === undefined
    ? { kind: "custom", minutes: String(seconds / 60) }
    : { kind: "preset", seconds: preset }
}

export function claimSecondsOf(claim: ClaimTime): number {
  switch (claim.kind) {
    case "preset":
      return claim.seconds
    case "custom":
      return Number(claim.minutes) * 60
  }
}

// Chat only on a platform without page entry, the page only on one without chat entry.
function fitEntryWays(ways: EntryWays, capabilities: PlatformCapabilities): EntryWays {
  if (entryWaysOffered(ways, capabilities)) return ways
  return capabilities.pageEntry ? "page" : "chat"
}

function entryWaysOf(rules: GiveawayRules): EntryWays {
  if (rules.chatKeyword === null) return "page"
  return rules.pageEntry ? "page-and-chat" : "chat"
}

function ticketCounts(typed: Values["tickets"]): Tickets {
  return {
    viewer: Number(typed.viewer),
    follower: Number(typed.follower),
    sub_t1: Number(typed.sub_t1),
    sub_t2: Number(typed.sub_t2),
    sub_t3: Number(typed.sub_t3),
    member: Number(typed.member),
    vip: Number(typed.vip),
    moderator: Number(typed.moderator),
  }
}

function textOrNull(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === "" ? null : trimmed
}

function isWholeNumber(text: string): boolean {
  return text.trim() !== "" && Number.isInteger(Number(text)) && Number(text) >= 0
}

// A datetime-local value has no zone; the browser reads it in the streamer's own zone.
function instantOf(text: string): string {
  return new Date(text).toISOString()
}
