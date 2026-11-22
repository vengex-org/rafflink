import type { AccountStore, Giveaway } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { RecentWinnersRule } from "../domain/rules.ts"
import type { Instant } from "../ports.ts"
import { dayMs } from "../stats/time.ts"
import type { BlockList, ExclusionsMissing, RoomExclusions } from "./giveaway-room.ts"
import type { RoomDirectory, RoomStub } from "./room-directory.ts"

/** What writing a room's excluded accounts reads: the block lists and earlier giveaways in the account store, and the earlier giveaways' rooms. */
export interface ExclusionDeps {
  readonly config: Pick<ResolvedConfig, "recentWinnersGiveawaysMax" | "blockListPushMax">
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
}

/** The giveaway fields the excluded accounts of its room come from. */
export type ExclusionTarget = Pick<Giveaway, "streamerId" | "platform" | "rules" | "createdAt">

/** Sends a room what its `unavailable` answer, or its init outcome, said it is missing. */
export async function sendMissingExclusions(
  deps: ExclusionDeps,
  room: Pick<RoomStub, "loadExclusions" | "replaceBlocked">,
  target: ExclusionTarget,
  missing: ExclusionsMissing,
): Promise<void> {
  switch (missing) {
    case "exclusions":
      return room.loadExclusions(await exclusionsFor(deps, target))
    case "block-list":
      return room.replaceBlocked(
        await blockListOf(deps.accounts, target.streamerId, target.platform),
      )
  }
}

/** What a room's init outcome leaves missing against the giveaway row; null when nothing is. */
export function missingAfterInit(
  init: { readonly exclusionsLoaded: boolean; readonly blockListVersion: number },
  giveaway: Pick<Giveaway, "blockListVersion">,
): ExclusionsMissing | null {
  if (!init.exclusionsLoaded) return "exclusions"
  return init.blockListVersion < giveaway.blockListVersion ? "block-list" : null
}

/**
 * Sends the streamer's block list to their newest open giveaways' rooms, at most
 * `BLOCK_LIST_PUSH_MAX`, one room request apiece. A room left out, or one that failed, holds an older
 * version and refuses entries until the entry flow sends it the list. Returns how many rooms failed;
 * each is logged.
 */
export async function pushBlockList(
  deps: ExclusionDeps,
  streamerId: string,
  platform: string,
): Promise<number> {
  const blocked = await blockListOf(deps.accounts, streamerId, platform)
  const giveawayIds = await deps.accounts.listOpenGiveawayIds(
    streamerId,
    deps.config.blockListPushMax,
  )
  const results = await Promise.allSettled(
    giveawayIds.map(async (giveawayId) => {
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

/**
 * The accounts a giveaway's room keeps out: the streamer's block list as it is now, and the winners of
 * the streamer's earlier drawn giveaways the rules name, read from their rooms. A pick that was
 * rerolled did not win and stays allowed.
 */
async function exclusionsFor(
  deps: ExclusionDeps,
  target: ExclusionTarget,
): Promise<RoomExclusions> {
  return {
    blocked: await blockListOf(deps.accounts, target.streamerId, target.platform),
    recentWinners: await recentWinnerIds(deps, target),
  }
}

async function blockListOf(
  accounts: AccountStore,
  streamerId: string,
  platform: string,
): Promise<BlockList> {
  const { version, blocks } = await accounts.blockList(streamerId, platform)
  return { version, platformUserIds: blocks.map((block) => block.platformUserId) }
}

// A giveaway counts once the account store shows it drawn. The draw route and the room alarm mirror
// the status right after a draw, so only a draw whose mirror failed is missed until its retry lands.
async function recentWinnerIds(deps: ExclusionDeps, target: ExclusionTarget): Promise<string[]> {
  const rule = target.rules.excludeRecentWinners
  if (rule === null) return []
  const { since, limit } = recentWindow(rule, target.createdAt, deps.config)
  const giveawayIds = await deps.accounts.listRecentDrawnGiveawayIds(
    target.streamerId,
    since,
    limit,
  )
  const picks = await Promise.all(giveawayIds.map((id) => deps.rooms.get(id).picks()))
  const winners = new Set<string>()
  for (const pick of picks.flat()) {
    if (pick.platform === target.platform && pick.claim.state !== "rerolled") {
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
