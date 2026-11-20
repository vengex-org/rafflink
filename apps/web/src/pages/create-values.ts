import { bestGroup, groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { CreateGiveawayBody } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"

export type Step = 1 | 2 | 3
export type Audience = "everyone" | "followers" | "subscribers"
export type Ending = "never" | "at-time"

/** The claim times offered as buttons, in seconds. */
export const claimPresets = [120, 300, 600] as const

export interface Values {
  title: string
  prize: string
  audience: Audience
  tickets: Record<Group, string>
  minAccountAgeDays: string
  ending: Ending
  closesAt: string
  claimSeconds: number
  claimKeyword: string
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
  claimSeconds: 300,
  claimKeyword: "",
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
    claimSeconds: giveaway.claimSeconds,
    claimKeyword: rules.claimKeyword ?? "",
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

/** The odds the ticket counts give, or null while a count is not a whole number. */
export function oddsOf(typed: Values["tickets"]): Odds | null {
  if (!groups.every((group) => isWholeNumber(typed[group]))) return null
  const tickets = ticketCounts(typed)
  if (tickets.viewer === 0) return { kind: "viewersOut" }
  if (groups.every((group) => tickets[group] === tickets.viewer)) return { kind: "same" }
  const best = bestGroup(tickets, groups)
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
    },
    closesAt: values.ending === "at-time" ? instantOf(values.closesAt) : undefined,
    claimSeconds: values.claimSeconds,
  }
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
