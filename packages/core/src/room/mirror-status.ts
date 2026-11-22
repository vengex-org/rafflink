import type { AccountStore } from "../accounts/account-store.ts"
import { errorClass } from "../lib/error-class.ts"
import type { Instant } from "../ports.ts"
import type { RoomStatus } from "./rows.ts"

/** The room as the route (an async stub) and the alarm (the room itself) both reach it. */
export interface MirroredRoom {
  markMirrored(status: RoomStatus): void | Promise<void>
}

/**
 * Copies the room's status to the account store, then tells the room it is mirrored. The room owns the
 * status: a failed copy stays pending in the room, whose alarm retries it, so nothing is thrown here.
 */
export async function mirrorStatus(
  room: MirroredRoom,
  accounts: Pick<AccountStore, "setStatus">,
  giveawayId: string,
  status: RoomStatus,
  now: Instant,
): Promise<void> {
  try {
    await accounts.setStatus(giveawayId, status, now)
  } catch (error) {
    console.warn("status mirror failed", { giveawayId, status, errorClass: errorClass(error) })
    return
  }
  try {
    await room.markMirrored(status)
  } catch (error) {
    console.warn("mirror mark failed", { giveawayId, status, errorClass: errorClass(error) })
  }
}
