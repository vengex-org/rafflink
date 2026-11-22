import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import { errorClass } from "../lib/error-class.ts"
import type { Clock } from "../ports.ts"
import { dayMs } from "../stats/time.ts"
import type { RoomDirectory } from "./room-directory.ts"

/** What deleting a giveaway reaches: its row in the account store and its room. */
export interface DeleteGiveawayDeps {
  readonly accounts: Pick<AccountStore, "deleteGiveaway" | "listExpiredGiveaways">
  readonly rooms: Pick<RoomDirectory, "delete">
}

/**
 * Deletes a giveaway: its room first, then its row, which frees the code. A failed room delete throws
 * before the row goes, so the giveaway stays listed and a repeat deletes it.
 */
export async function deleteGiveaway(deps: DeleteGiveawayDeps, giveawayId: string): Promise<void> {
  await deps.rooms.delete(giveawayId)
  await deps.accounts.deleteGiveaway(giveawayId)
}

/**
 * Deletes up to `HISTORY_RETENTION_SWEEP_BATCH` drawn giveaways that closed more than `days` ago, the set
 * `HISTORY_RETENTION_DAYS`. A giveaway that fails is logged and the next sweep tries it again. Returns how many
 * were deleted.
 */
export async function deleteExpiredGiveaways(
  deps: DeleteGiveawayDeps & {
    readonly clock: Clock
    readonly config: Pick<ResolvedConfig, "historyRetentionSweepBatch">
  },
  days: number,
): Promise<number> {
  const before = deps.clock.now() - days * dayMs
  let deleted = 0
  for (const giveawayId of await deps.accounts.listExpiredGiveaways(
    before,
    deps.config.historyRetentionSweepBatch,
  )) {
    try {
      await deleteGiveaway(deps, giveawayId)
      deleted++
    } catch (error) {
      console.warn("history retention failed for a giveaway", {
        giveawayId,
        errorClass: errorClass(error),
      })
    }
  }
  return deleted
}
