import type { GiveawayRules } from "./rules.ts"

/**
 * What a streamer may turn on that needs platform permissions beyond the sign-in's: reading followers,
 * subscribers, reward redemptions, VIPs and moderators, and moderator links for moderators only. Each is
 * asked for only when a giveaway first uses it.
 */
export const streamerFeatures = ["followers", "subs", "redemptions", "roles", "modlinks"] as const

export type StreamerFeature = (typeof streamerFeatures)[number]

/** The rules a feature depends on. */
type FeatureRules = Pick<
  GiveawayRules,
  "tickets" | "subsOnly" | "followersOnly" | "subEntry" | "pointsReward"
>

/** Whether a follow changes who enters or with how many tickets. */
export function followMatters(rules: FeatureRules): boolean {
  return rules.followersOnly || rules.tickets.follower !== rules.tickets.viewer
}

/** Whether a subscription tier changes who enters or with how many tickets. */
export function tierMatters(rules: FeatureRules): boolean {
  const { tickets } = rules
  return (
    rules.subsOnly
    || [tickets.sub_t1, tickets.sub_t2, tickets.sub_t3].some((count) => count !== tickets.viewer)
  )
}

/** Whether being a VIP or a moderator changes how many tickets someone enters with. */
export function rolesMatter(rules: FeatureRules): boolean {
  const { tickets } = rules
  return tickets.vip !== tickets.viewer || tickets.moderator !== tickets.viewer
}

/** The features a giveaway with these rules needs; moderator links are asked for when one is made. */
export function featuresOfRules(rules: FeatureRules): readonly StreamerFeature[] {
  const used: Readonly<Record<StreamerFeature, boolean>> = {
    followers: followMatters(rules),
    subs: rules.subEntry || tierMatters(rules),
    redemptions: rules.pointsReward !== null,
    roles: rolesMatter(rules),
    modlinks: false,
  }
  return streamerFeatures.filter((feature) => used[feature])
}

/** The features of a stored or sent list; null when it is not a list of them. */
export function parseFeatures(value: unknown): readonly StreamerFeature[] | null {
  if (!Array.isArray(value)) return null
  const features = value.flatMap((item) => streamerFeatures.filter((feature) => feature === item))
  return features.length === value.length ? features : null
}
