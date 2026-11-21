import type { AccountStore } from "../accounts/account-store.ts"
import { errorClass } from "../lib/error-class.ts"
import type { RoomDirectory } from "./room-directory.ts"

/**
 * Wakes the rooms of up to `batchSize` giveaways that are no longer open and were not woken before, so
 * a room whose alarm was cleared before retention existed arms its deletion alarm. Returns how many rooms woke.
 */
export async function armRetentionAlarms(
  accounts: Pick<AccountStore, "listUnarmedRetention" | "markRetentionArmed">,
  rooms: RoomDirectory,
  batchSize: number,
): Promise<number> {
  let woken = 0
  for (const giveawayId of await accounts.listUnarmedRetention(batchSize)) {
    try {
      // Opening a room arms its alarm; any call opens it.
      await rooms.get(giveawayId).summary()
      await accounts.markRetentionArmed(giveawayId)
      woken++
    } catch (error) {
      console.warn("retention sweep failed for a room", {
        giveawayId,
        errorClass: errorClass(error),
      })
    }
  }
  return woken
}
