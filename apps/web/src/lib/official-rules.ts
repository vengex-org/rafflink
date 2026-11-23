import { supportedGroups, type Group } from "@rafflink/core/domain/groups"
import type { GiveawayView } from "../api/client.ts"
import type { I18n } from "../i18n/i18n.tsx"
import { platformNames } from "./platform-name.ts"
import {
  claimTimeText,
  oddsText,
  recentWinnersText,
  ticketOdds,
  ticketText,
  whoCanEnterText,
} from "./rules-text.ts"

/** A giveaway's rules in the viewer's language, built from its settings; the streamer's extra terms stay as written. */
export interface OfficialRules {
  readonly tickets: readonly string[]
  readonly lines: readonly string[]
  /** The heading over the extra terms and the terms; null when the streamer added none. */
  readonly extraTerms: { readonly heading: string; readonly text: string } | null
  readonly notice: string
}

export function officialRules(
  i18n: I18n,
  giveaway: GiveawayView,
  verifyUrl: string,
): OfficialRules {
  const { t } = i18n
  const { rules, streamerName: name } = giveaway
  const shown = supportedGroups(giveaway.capabilities)
  const recentWinners = recentWinnersText(i18n, rules.excludeRecentWinners)
  const lines = [
    t("rules.organizer", { name }),
    t("rules.platform", { platform: platformNames[giveaway.platform] }),
    giveaway.prize === null
      ? t("rules.prizeNone", { name })
      : t("rules.prize", { prize: giveaway.prize }),
    ...entryLines(i18n, giveaway),
    ...priceLines(i18n, giveaway, shown),
    whoCanEnterText(i18n, rules.subsOnly, rules.followersOnly, rules.tickets.viewer === 0),
    t("rules.blocked", { name }),
    t("rules.broadcaster", { name }),
    ...(rules.minAccountAgeDays === null
      ? []
      : [t("rules.accountAge", { days: i18n.plural("day", rules.minAccountAgeDays) })]),
    ...(recentWinners === null ? [] : [recentWinners]),
    ...(rules.minAge === null
      ? []
      : [t("rules.minAge", { age: i18n.plural("year", rules.minAge) })]),
    ...(rules.excludedCountries === null
      ? []
      : [t("rules.excludedCountries", { places: withoutFinalPeriods(rules.excludedCountries) })]),
    ...(rules.minAge === null && rules.excludedCountries === null
      ? []
      : [t("rules.checkedByStreamer", { name })]),
    oddsText(i18n, ticketOdds(rules.tickets, shown)),
    giveaway.closesAt === null
      ? t("rules.entriesEndManual", { name })
      : t("rules.entriesEnd", { time: i18n.dateTime(giveaway.closesAt), name }),
    t("rules.draw"),
    t("rules.verify", { url: verifyUrl }),
    t("rules.claimTime", { time: claimTimeText(i18n, giveaway.claimSeconds) }),
    t("rules.claimWhere"),
    t("rules.claimLate", { name }),
    t("rules.delivery", { name }),
    ...(rules.winnerForm.length === 0
      ? []
      : [
          t("rules.winnerForm", {
            name,
            fields: rules.winnerForm.map((kind) => t(`winnerField.${kind}`)).join(", "),
          }),
        ]),
  ]
  return {
    tickets: shown.map((group) =>
      t("rules.groupTickets", {
        group: t(`group.${group}`),
        tickets: ticketText(i18n, rules.tickets[group]),
      }),
    ),
    lines,
    extraTerms:
      rules.extraTerms === null
        ? null
        : { heading: t("rules.extraTerms", { name }), text: rules.extraTerms },
    notice: t("rules.notice"),
  }
}

/** The rules as plain text for the streamer to post elsewhere, under a heading with the giveaway link. */
export function officialRulesText(i18n: I18n, rules: OfficialRules, giveawayUrl: string): string {
  return [
    i18n.t("rules.copyHeading", { url: giveawayUrl }),
    ...rules.tickets,
    ...rules.lines,
    ...(rules.extraTerms === null ? [] : [rules.extraTerms.heading, rules.extraTerms.text]),
    rules.notice,
  ].join("\n")
}

function entryLines(i18n: I18n, giveaway: GiveawayView): string[] {
  const { chatKeyword, pageEntry, subEntry, pointsReward } = giveaway.rules
  const platform = platformNames[giveaway.platform]
  return [
    ...(pageEntry ? [i18n.t("rules.enterPage", { platform })] : []),
    ...(chatKeyword === null
      ? []
      : [
          i18n.t("rules.enterChat", {
            keyword: chatKeyword,
            name: giveaway.streamerName,
            platform,
          }),
        ]),
    ...(subEntry ? [i18n.t("rules.enterSub", { name: giveaway.streamerName })] : []),
    ...(pointsReward === null ? [] : [i18n.t("rules.enterPoints", { reward: pointsReward.title })]),
  ]
}

// Following is free, so a ticket for viewers or followers is a free way in; a subscription is a purchase.
function priceLines(i18n: I18n, giveaway: GiveawayView, shown: readonly Group[]): string[] {
  const { subsOnly, tickets } = giveaway.rules
  if (subsOnly) return [i18n.t("rules.paidOnly")]
  if (Math.max(tickets.viewer, tickets.follower) > 0) return [i18n.t("rules.free")]
  const withTickets = shown.filter((group) => tickets[group] > 0)
  const onlySubsGetTickets =
    withTickets.length > 0 && withTickets.every((group) => group.startsWith("sub_"))
  return onlySubsGetTickets ? [i18n.t("rules.paidOnly")] : []
}

// The sentence around the places ends with its own period.
function withoutFinalPeriods(text: string): string {
  return text.replace(/\.+$/, "")
}
