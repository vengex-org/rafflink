import { groups } from "@rafflink/core/domain/groups"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import { formatClock } from "./use-remaining.ts"

export function whoCanEnterText(subsOnly: boolean, followersOnly: boolean): string {
  if (subsOnly && followersOnly) return "Only subscribers who follow the channel can enter."
  if (subsOnly) return "Only subscribers can enter."
  if (followersOnly) return "Only followers can enter."
  return "Everyone can enter."
}

/** The one sentence about extra tickets a viewer reads before signing in; null when nobody gets extra. */
export function extraTicketsText(tickets: GiveawayRules["tickets"]): string | null {
  const extra = groups.filter((group) => tickets[group] > tickets.viewer)
  if (extra.length === 0) return null
  const onlySubs = extra.every((group) => group.startsWith("sub_"))
  if (
    onlySubs
    && extra.length === 3
    && tickets.sub_t1 === tickets.sub_t2
    && tickets.sub_t2 === tickets.sub_t3
  ) {
    return `Subscribers get ${tickets.sub_t1} ${ticketWord(tickets.sub_t1)}.`
  }
  return "Some viewers get extra tickets. The list below shows how many."
}

export function ticketText(count: number): string {
  return count === 0 ? "cannot enter" : `${count} ${ticketWord(count)}`
}

function ticketWord(count: number): string {
  return count === 1 ? "ticket" : "tickets"
}

/** "5 minutes" for whole minutes, the clock otherwise. */
export function claimTimeText(seconds: number): string {
  if (seconds % 60 !== 0) return `${formatClock(seconds * 1000)} minutes`
  const minutes = seconds / 60
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

export function peopleText(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"} entered`
}

/** How long a queued entry may take, in whole minutes: "1 minute", "2 minutes". */
export function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}
