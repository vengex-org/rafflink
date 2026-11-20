import { groups, type Group } from "@rafflink/core/domain/groups"
import type { CreateGiveawayBody } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"

export type Step = 1 | 2 | 3 | 4
export type Audience = "everyone" | "followers" | "subscribers"
export type Ending = "never" | "at-time"

/** The seconds a winner gets to claim, as the streamer picks them. */
export const claimPresets = [120, 300, 600] as const
export type ClaimPreset = (typeof claimPresets)[number]

export interface Values {
  title: string
  prize: string
  audience: Audience
  tickets: Record<Group, string>
  minAccountAgeDays: string
  ending: Ending
  closesAt: string
  claimSeconds: ClaimPreset
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

/** The first thing wrong with the answers of one step, or null; the server checks everything again. */
export function stepIssue(step: Step, values: Values, now: number): Issue | null {
  switch (step) {
    case 1:
    case 4:
      return null
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
    case 3: {
      if (values.ending === "never") return null
      const end = new Date(values.closesAt).getTime()
      if (Number.isNaN(end)) {
        return { field: "closesAt", message: "issue.pickEnd" }
      }
      return end > now ? null : { field: "closesAt", message: "issue.future" }
    }
  }
}

/** Which step asks for the field the server complained about; the review step for a field no step owns. */
export function stepOfField(field: string): Step {
  if (field === "title" || field === "prize") return 1
  if (field.startsWith("tickets.") || field === "minAccountAgeDays") return 2
  if (field === "closesAt" || field === "claimSeconds" || field === "claimKeyword") return 3
  return 4
}

export function toBody(values: Values): CreateGiveawayBody {
  return {
    title: values.title,
    prize: values.prize,
    rules: {
      tickets: {
        viewer: Number(values.tickets.viewer),
        follower: Number(values.tickets.follower),
        sub_t1: Number(values.tickets.sub_t1),
        sub_t2: Number(values.tickets.sub_t2),
        sub_t3: Number(values.tickets.sub_t3),
        vip: Number(values.tickets.vip),
        moderator: Number(values.tickets.moderator),
      },
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

function isWholeNumber(text: string): boolean {
  return text.trim() !== "" && Number.isInteger(Number(text)) && Number(text) >= 0
}

// A datetime-local value has no zone; the browser reads it in the streamer's own zone.
function instantOf(text: string): string {
  return new Date(text).toISOString()
}
