import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import type { GiveawayRoom } from "./giveaway-room.ts"
import type { RoomStatus } from "./rows.ts"
import { openGiveawayStreamerAccess } from "./streamer-access.ts"

/** What the room's alarm asks of the adapter: the role lists need Twitch, the status mirror needs the account store. */
export async function runRoomAlarm(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  const duties = room.onAlarm()
  if (duties.refreshRoles) await refreshRoles(deps, giveawayId, room)
  if (duties.mirrorStatus !== null) await mirrorStatus(deps, giveawayId, room, duties.mirrorStatus)
}

// Every failure is counted on the room, whose live page shows it; the room logs it with the giveaway id.
async function refreshRoles(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  try {
    const { accessToken, broadcasterId } = await openGiveawayStreamerAccess(deps, giveawayId)
    const roles = await deps.twitch.channelRoles(accessToken, broadcasterId)
    room.replaceRoles(roles.vips, roles.moderators)
  } catch (error) {
    room.recordFailure("role-refresh", error)
  }
}

// A failed mirror stays pending in the room, whose alarm retries it after `mirrorRetrySeconds`.
async function mirrorStatus(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
  status: RoomStatus,
): Promise<void> {
  try {
    await deps.accounts.setStatus(giveawayId, status)
    room.markMirrored(status)
  } catch (error) {
    console.warn("status mirror failed", {
      giveawayId,
      status,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
    })
  }
}
