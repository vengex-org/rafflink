import { bestGroup, groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import type { I18n } from "../i18n/i18n.tsx"
import { formatClock } from "./use-remaining.ts"

/** `viewersOut` when plain viewers get no tickets, so not everyone can enter even without a filter. */
export function whoCanEnterText(
  i18n: I18n,
  subsOnly: boolean,
  followersOnly: boolean,
  viewersOut: boolean,
): string {
  if (subsOnly && followersOnly) return i18n.t("who.both")
  if (subsOnly) return i18n.t("who.subs")
  if (followersOnly) return i18n.t("who.followers")
  return viewersOut ? i18n.t("who.ticketGroups") : i18n.t("who.everyone")
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

/** How a viewer's chance compares with the best-off group. */
export type Odds =
  | { readonly kind: "same" }
  | { readonly kind: "viewersOut" }
  | { readonly kind: "noBetter" }
  | { readonly kind: "times"; readonly group: Exclude<Group, "viewer">; readonly times: number }

/** The odds among the `shown` groups, the ones the giveaway's platform supports. */
export function ticketOdds(tickets: Tickets, shown: readonly Group[]): Odds {
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

export function oddsText(i18n: I18n, odds: Odds): string {
  switch (odds.kind) {
    case "same":
    case "viewersOut":
    case "noBetter":
      return i18n.t(`odds.${odds.kind}`)
    case "times":
      return i18n.t(`odds.${odds.group}`, { times: i18n.number(odds.times) })
  }
}
