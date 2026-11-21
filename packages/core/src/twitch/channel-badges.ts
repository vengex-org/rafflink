import type { ResolvedConfig } from "../config.ts"
import { errorClass } from "../lib/error-class.ts"
import type { Clock, Instant } from "../ports.ts"
import { TwitchError, type SubscriptionGroup, type TwitchClient } from "./twitch-client.ts"

/** The image of each subscription tier's badge; `null` when no image is known for the tier. */
export type SubscriberBadges = Readonly<Record<SubscriptionGroup, string | null>>

export type ChannelBadgesConfig = Pick<ResolvedConfig, "channelBadgesTtlSeconds">

const noBadges: SubscriberBadges = { sub_t1: null, sub_t2: null, sub_t3: null }

interface Cached {
  readonly expiresAt: Instant
  /** Shared by concurrent callers, so a burst of live pages costs one read. */
  readonly badges: Promise<SubscriberBadges | null>
}

/**
 * The subscriber badges of channels, read once per channel and kept for `channelBadgesTtlSeconds`.
 * A tier the channel has no badge for shows the global subscriber badge.
 */
export class ChannelBadges {
  private readonly cache = new Map<string, Cached>()

  constructor(
    private readonly twitch: Pick<
      TwitchClient,
      "appAccessToken" | "channelSubscriberBadges" | "globalSubscriberBadge"
    >,
    private readonly clock: Clock,
    private readonly config: ChannelBadgesConfig,
  ) {}

  /** No badges when Twitch is unavailable; that answer is not kept, so the next call asks again. */
  async of(broadcasterId: string): Promise<SubscriberBadges> {
    const now = this.clock.now()
    let entry = this.cache.get(broadcasterId)
    if (entry === undefined || entry.expiresAt <= now) {
      this.dropExpired(now)
      entry = {
        expiresAt: now + this.config.channelBadgesTtlSeconds * 1000,
        badges: this.read(broadcasterId),
      }
      this.cache.set(broadcasterId, entry)
    }
    const badges = await entry.badges
    if (badges !== null) return badges
    if (this.cache.get(broadcasterId) === entry) this.cache.delete(broadcasterId)
    return noBadges
  }

  private async read(broadcasterId: string): Promise<SubscriberBadges | null> {
    try {
      const token = await this.twitch.appAccessToken()
      const own = await this.twitch.channelSubscriberBadges(token, broadcasterId)
      const complete = own.sub_t1 !== null && own.sub_t2 !== null && own.sub_t3 !== null
      const fallback = complete ? null : await this.twitch.globalSubscriberBadge(token)
      return {
        sub_t1: own.sub_t1 ?? fallback,
        sub_t2: own.sub_t2 ?? fallback,
        sub_t3: own.sub_t3 ?? fallback,
      }
    } catch (error) {
      if (!(error instanceof TwitchError)) throw error
      console.warn("channel badges unavailable", { broadcasterId, errorClass: errorClass(error) })
      return null
    }
  }

  private dropExpired(now: Instant): void {
    for (const [broadcasterId, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(broadcasterId)
    }
  }
}
