import type { AccountStore } from "../accounts/account-store.ts"
import { errorClass } from "../lib/error-class.ts"
import type { Instant } from "../ports.ts"
import type { RoomMirror } from "./giveaway-room.ts"

/** The room as the route (an async stub) and the alarm (the room itself) both reach it. */
export interface MirroredRoom {
  mirrorState(): RoomMirror | Promise<RoomMirror>
  markMirrored(mirrored: RoomMirror): void | Promise<void>
}

/**
 * Copies the room's status and counts to the account store, then tells the room what is mirrored. The
 * room owns them: a failed copy stays pending in the room, whose alarm retries it, so nothing is thrown here.
 */
export async function mirrorStatus(
  room: MirroredRoom,
  accounts: Pick<AccountStore, "setStatus">,
  giveawayId: string,
  now: Instant,
): Promise<void> {
  let mirror: RoomMirror
  try {
    mirror = await room.mirrorState()
  } catch (error) {
    console.warn("mirror state read failed", { giveawayId, errorClass: errorClass(error) })
    return
  }
  try {
    await accounts.setStatus(giveawayId, mirror, now)
  } catch (error) {
    console.warn("status mirror failed", {
      giveawayId,
      status: mirror.status,
      errorClass: errorClass(error),
    })
    return
  }
  try {
    await room.markMirrored(mirror)
  } catch (error) {
    console.warn("mirror mark failed", {
      giveawayId,
      status: mirror.status,
      errorClass: errorClass(error),
    })
  }
}
