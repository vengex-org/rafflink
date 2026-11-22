import {
  bestGroup,
  groups,
  supportedGroups,
  type Group,
  type Tickets,
} from "@rafflink/core/domain/groups"
import type { GiveawayRules, RecentWinnersRule } from "@rafflink/core/domain/rules"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { PlatformCapabilities } from "@rafflink/core/platform/provider"
import type { CreateGiveawayBody } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"

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
  winnerCount: string
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
  winnerCount: "1",
}

/** What the wizard offers until the session answers; the server refuses a rule the streamer's platform cannot check. */
export const everyCapability: PlatformCapabilities = {
  followerCheck: true,
  subTiers: true,
  vip: true,
  accountAge: true,
  pageEntry: true,
  chatEntry: true,
}

/**
 * The answers as the platform can check them: a group it cannot tell gets 0 tickets, and a filter or entry way it
 * lacks falls back to one it has. The wizard hides those controls, so an answer kept from elsewhere never reaches the server.
 */
export function fitValues(values: Values, capabilities: PlatformCapabilities): Values {
  const supported = supportedGroups(capabilities)
  const tickets = { ...values.tickets }
  for (const group of groups) if (!supported.includes(group)) tickets[group] = "0"
  return {
    ...values,
    tickets,
    audience: audienceOffered(values.audience, capabilities) ? values.audience : "everyone",
    minAccountAgeDays: capabilities.accountAge ? values.minAccountAgeDays : "",
    entryWays: fitEntryWays(values.entryWays, capabilities),
  }
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
  }
}

/** The first thing wrong with the answers of one step, or null; the server checks everything again. */
export function stepIssue(step: Step, values: Values, now: number): Issue | null {
  switch (step) {
    case 1: {
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
  if (field === "title" || field === "prize" || field === "closesAt") return 1
  if (
    field.startsWith("tickets.")
    || field === "minAccountAgeDays"
    || field === "claimSeconds"
    || field === "claimKeyword"
    || field === "chatKeyword"
    || field === "winnerCount"
    || field.startsWith("excludeRecentWinners")
  ) {
    return 2
  }
  return 3
}

/** How a viewer's chance compares with the best-off group, from the ticket counts as typed. */
export type Odds =
  | { readonly kind: "same" }
  | { readonly kind: "viewersOut" }
  | { readonly kind: "noBetter" }
  | { readonly kind: "times"; readonly group: Exclude<Group, "viewer">; readonly times: number }

/** The odds the ticket counts of the `shown` groups give, or null while a count is not a whole number. */
export function oddsOf(typed: Values["tickets"], shown: readonly Group[]): Odds | null {
  if (!shown.every((group) => isWholeNumber(typed[group]))) return null
  const tickets = ticketCounts(typed)
  if (tickets.viewer === 0) return { kind: "viewersOut" }
  if (shown.every((group) => tickets[group] === tickets.viewer)) return { kind: "same" }
  const best = bestGroup(tickets, shown)
  if (best.group === "viewer" || best.tickets === tickets.viewer) return { kind: "noBetter" }
  return {
    kind: "times",
    group: best.group,
    times: Math.round((best.tickets / tickets.viewer) * 10) / 10,
  }
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
    vip: Number(typed.vip),
    moderator: Number(typed.moderator),
  }
}

function isWholeNumber(text: string): boolean {
  return text.trim() !== "" && Number.isInteger(Number(text)) && Number(text) >= 0
}

// A datetime-local value has no zone; the browser reads it in the streamer's own zone.
function instantOf(text: string): string {
  return new Date(text).toISOString()
}
