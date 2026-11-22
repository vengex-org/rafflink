import { groups } from "@rafflink/core/domain/groups"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import type { I18n } from "../i18n/i18n.tsx"
import { formatClock } from "./use-remaining.ts"

export function whoCanEnterText(i18n: I18n, subsOnly: boolean, followersOnly: boolean): string {
  if (subsOnly && followersOnly) return i18n.t("who.both")
  if (subsOnly) return i18n.t("who.subs")
  if (followersOnly) return i18n.t("who.followers")
  return i18n.t("who.everyone")
}

/** The one sentence about extra tickets a viewer reads before signing in; null when nobody gets extra. */
export function extraTicketsText(i18n: I18n, tickets: GiveawayRules["tickets"]): string | null {
  const extra = groups.filter((group) => tickets[group] > tickets.viewer)
  if (extra.length === 0) return null
  const onlySubs = extra.every((group) => group.startsWith("sub_"))
  if (
    onlySubs
    && extra.length === 3
    && tickets.sub_t1 === tickets.sub_t2
    && tickets.sub_t2 === tickets.sub_t3
  ) {
    return i18n.t("extraTickets.subs", { tickets: i18n.plural("ticket", tickets.sub_t1) })
  }
  return i18n.t("extraTickets.some")
}

/** The sentence about earlier winners who cannot enter; null when the giveaway keeps none out. */
export function recentWinnersText(
  i18n: I18n,
  rule: GiveawayRules["excludeRecentWinners"],
): string | null {
  if (rule === null) return null
  switch (rule.kind) {
    case "giveaways":
      return i18n.plural("recentGiveaways", rule.count)
    case "days":
      return i18n.plural("recentDays", rule.count)
  }
}

export function ticketText(i18n: I18n, count: number): string {
  return count === 0 ? i18n.t("ticket.cannotEnter") : i18n.plural("ticket", count)
}

/** "5 minutes" for whole minutes, the clock otherwise. */
export function claimTimeText(i18n: I18n, seconds: number): string {
  if (seconds % 60 !== 0) return i18n.t("claimTime.clock", { clock: formatClock(seconds * 1000) })
  return i18n.plural("minute", seconds / 60)
}

export function peopleText(i18n: I18n, count: number): string {
  return i18n.plural("entered", count)
}

/** How long a queued entry may take, in whole minutes: "1 minute", "2 minutes". */
export function waitText(i18n: I18n, ms: number): string {
  return i18n.plural("minute", Math.max(1, Math.ceil(ms / 60_000)))
}
