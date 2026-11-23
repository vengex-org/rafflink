import { bestGroup, groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import type { I18n, PluralBase } from "../i18n/i18n.tsx"
import { formatClock } from "./use-remaining.ts"

/** `viewersOut` when plain viewers get no tickets, so not everyone can enter even without a filter. */
export function whoCanEnterText(
  i18n: I18n,
  subsOnly: boolean,
  followersOnly: boolean,
  viewersOut: boolean,
): string {
  return i18n.t(`who.${audience(subsOnly, followersOnly, viewersOut)}`)
}

/** Who can enter as one short line for the viewer: the audience, then extra tickets and earlier winners when they apply. */
export function whoCanEnterSummary(i18n: I18n, rules: GiveawayRules): string {
  const parts = [
    i18n.t(`whoShort.${audience(rules.subsOnly, rules.followersOnly, rules.tickets.viewer === 0)}`),
    extraTicketsText(i18n, rules.tickets),
    recentWinnersText(i18n, rules.excludeRecentWinners, { kind: "short" }),
  ]
  return parts.filter((part) => part !== null).join(" · ")
}

function audience(
  subsOnly: boolean,
  followersOnly: boolean,
  viewersOut: boolean,
): "both" | "subs" | "followers" | "everyone" | "ticketGroups" {
  if (subsOnly && followersOnly) return "both"
  if (subsOnly) return "subs"
  if (followersOnly) return "followers"
  return viewersOut ? "ticketGroups" : "everyone"
}

/** The short note about extra tickets; null when nobody gets extra. */
function extraTicketsText(i18n: I18n, tickets: GiveawayRules["tickets"]): string | null {
  const extra = groups.filter((group) => tickets[group] > tickets.viewer)
  if (extra.length === 0) return null
  const onlySubs = extra.every((group) => group.startsWith("sub_"))
  if (
    onlySubs
    && extra.length === 3
    && tickets.sub_t1 === tickets.sub_t2
    && tickets.sub_t2 === tickets.sub_t3
  ) {
    return i18n.t("extraTicketsShort.subs", { tickets: i18n.plural("ticket", tickets.sub_t1) })
  }
  return i18n.t("extraTicketsShort.some")
}

/** Who reads the recent-winners rule: the official rules name the channel, the streamer's review says "your", the viewer's summary line takes a short fragment. */
export type RecentWinnersWording =
  | { readonly kind: "rules"; readonly name: string }
  | { readonly kind: "own" }
  | { readonly kind: "short" }

type RecentWinnersRule = NonNullable<GiveawayRules["excludeRecentWinners"]>

const recentWinnersBases = {
  rules: { giveaways: "recentGiveaways", days: "recentDays" },
  own: { giveaways: "recentGiveawaysOwn", days: "recentDaysOwn" },
  short: { giveaways: "recentGiveawaysShort", days: "recentDaysShort" },
} as const satisfies Record<
  RecentWinnersWording["kind"],
  Record<RecentWinnersRule["kind"], PluralBase>
>

/** The text about earlier winners who cannot enter; null when the giveaway keeps none out. */
export function recentWinnersText(
  i18n: I18n,
  rule: GiveawayRules["excludeRecentWinners"],
  wording: RecentWinnersWording,
): string | null {
  if (rule === null) return null
  const base = recentWinnersBases[wording.kind][rule.kind]
  return i18n.plural(base, rule.count, wording.kind === "rules" ? { name: wording.name } : {})
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
