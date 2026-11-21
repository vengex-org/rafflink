import type { AccountStore } from "../accounts/account-store.ts"
import { errorClass } from "../lib/error-class.ts"
import type { RoomDirectory } from "./room-directory.ts"

/**
 * Wakes the rooms of up to `batchSize` giveaways that are no longer open and were not woken before, so
 * a room whose alarm was cleared before retention existed arms its deletion alarm. A room that fails
 * sorts behind the others and is given up after `maxAttempts` failed sweeps. Returns how many rooms woke.
 */
export async function armRetentionAlarms(
  accounts: Pick<
    AccountStore,
    "listUnarmedRetention" | "markRetentionArmed" | "recordRetentionFailure"
  >,
  rooms: RoomDirectory,
  batchSize: number,
  maxAttempts: number,
): Promise<number> {
  let woken = 0
  for (const giveawayId of await accounts.listUnarmedRetention(batchSize, maxAttempts)) {
    try {
      // Opening a room arms its alarm; any call opens it.
      await rooms.get(giveawayId).summary()
    } catch (error) {
      console.warn("retention sweep failed for a room", {
        giveawayId,
        errorClass: errorClass(error),
      })
      await giveUpAtLimit(accounts, giveawayId, maxAttempts)
      continue
    }
    // The room is armed; a failed mark only lists it once more, which is no room failure.
    try {
      await accounts.markRetentionArmed(giveawayId)
      woken++
    } catch (error) {
      console.warn("retention sweep could not mark a room", {
        giveawayId,
        errorClass: errorClass(error),
      })
    }
  }
  return woken
}

// Past the limit the entrants of the room are never deleted unless a human looks at it.
async function giveUpAtLimit(
  accounts: Pick<AccountStore, "recordRetentionFailure">,
  giveawayId: string,
  maxAttempts: number,
): Promise<void> {
  try {
    const attempts = await accounts.recordRetentionFailure(giveawayId)
    if (attempts >= maxAttempts) {
      console.error("retention sweep gave up on a room", { giveawayId, attempts })
    }
  } catch (error) {
    console.warn("retention sweep could not count a failure", {
      giveawayId,
      errorClass: errorClass(error),
    })
  }
}
