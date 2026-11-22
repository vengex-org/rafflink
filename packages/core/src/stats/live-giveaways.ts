import { errorClass } from "../lib/error-class.ts"
import type { Instant } from "../ports.ts"
import type { LiveCounts, RoomDirectory } from "../room/room-directory.ts"
import type { StatsStore } from "./stats-store.ts"

/** An open giveaway on the admin page. `counts` is null when its room did not answer. */
export interface AdminLiveGiveawayJson {
  readonly code: string
  readonly title: string | null
  readonly streamerName: string
  readonly closesAt: Instant | null
  readonly counts: LiveCounts | null
}

export interface LiveGiveaways {
  /** Every open giveaway, also those past `max` that were not asked. */
  readonly total: number
  readonly giveaways: readonly AdminLiveGiveawayJson[]
}

/** The newest `max` open giveaways with the live counts of their rooms; one room call each, so `max` bounds the fan-out. */
export async function liveGiveaways(
  deps: { readonly stats: Pick<StatsStore, "openGiveaways">; readonly rooms: RoomDirectory },
  max: number,
): Promise<LiveGiveaways> {
  const { total, giveaways } = await deps.stats.openGiveaways(max)
  const counted = await Promise.allSettled(
    giveaways.map((giveaway) => deps.rooms.get(giveaway.id).liveCounts()),
  )
  return {
    total,
    giveaways: giveaways.map((giveaway, index) => {
      const result = counted[index]
      if (result?.status === "rejected") {
        console.warn("room counts unavailable", {
          giveawayId: giveaway.id,
          errorClass: errorClass(result.reason),
        })
      }
      return {
        code: giveaway.code,
        title: giveaway.title,
        streamerName: giveaway.streamerName,
        closesAt: giveaway.closesAt,
        counts: result?.status === "fulfilled" ? result.value : null,
      }
    }),
  }
}
