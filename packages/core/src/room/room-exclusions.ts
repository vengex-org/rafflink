import type { AccountStore, Giveaway } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { RecentWinnersRule } from "../domain/rules.ts"
import type { Instant } from "../ports.ts"
import { dayMs } from "../stats/time.ts"
import type { RoomExclusions } from "./giveaway-room.ts"
import type { RoomDirectory } from "./room-directory.ts"

export interface ExclusionDeps {
  readonly config: Pick<ResolvedConfig, "recentWinnersGiveawaysMax">
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
}

/**
 * The accounts a giveaway's room keeps out: the streamer's block list as it is now, and the winners of
 * the streamer's earlier drawn giveaways the rules name, read from their rooms. A pick that was
 * rerolled did not win and stays allowed.
 */
export async function exclusionsFor(
  deps: ExclusionDeps,
  giveaway: Giveaway,
): Promise<RoomExclusions> {
  return {
    blocked: await blockedIds(deps.accounts, giveaway.streamerId, giveaway.platform),
    recentWinners: await recentWinnerIds(deps, giveaway),
  }
}

/**
 * Sends the streamer's block list to each of their open giveaways' rooms, one room request apiece.
 * Returns how many rooms could not be reached; each is logged, and a repeat of the edit sends again.
 */
export async function pushBlockList(
  deps: ExclusionDeps,
  streamerId: string,
  platform: string,
): Promise<number> {
  const blocked = await blockedIds(deps.accounts, streamerId, platform)
  const results = await Promise.allSettled(
    (await deps.accounts.listOpenGiveawayIds(streamerId)).map(async (giveawayId) => {
      try {
        await deps.rooms.get(giveawayId).replaceBlocked(blocked)
      } catch (error) {
        console.warn("block list did not reach the room", { giveawayId, error })
        throw error
      }
    }),
  )
  return results.filter((result) => result.status === "rejected").length
}

async function blockedIds(
  accounts: AccountStore,
  streamerId: string,
  platform: string,
): Promise<string[]> {
  return (await accounts.listBlocks(streamerId))
    .filter((block) => block.platform === platform)
    .map((block) => block.platformUserId)
}

async function recentWinnerIds(deps: ExclusionDeps, giveaway: Giveaway): Promise<string[]> {
  const rule = giveaway.rules.excludeRecentWinners
  if (rule === null) return []
  const { since, limit } = recentWindow(rule, giveaway.createdAt, deps.config)
  const giveawayIds = await deps.accounts.listRecentDrawnGiveawayIds(
    giveaway.streamerId,
    since,
    limit,
  )
  const picks = await Promise.all(giveawayIds.map((id) => deps.rooms.get(id).picks()))
  const winners = new Set<string>()
  for (const pick of picks.flat()) {
    if (pick.platform === giveaway.platform && pick.claim.state !== "rerolled") {
      winners.add(pick.platformUserId)
    }
  }
  return [...winners]
}

function recentWindow(
  rule: RecentWinnersRule,
  createdAt: Instant,
  config: ExclusionDeps["config"],
): { since: Instant; limit: number } {
  switch (rule.kind) {
    case "giveaways":
      return { since: 0, limit: rule.count }
    case "days":
      return { since: createdAt - rule.count * dayMs, limit: config.recentWinnersGiveawaysMax }
  }
}
