import type { Giveaway } from "../accounts/account-store.ts"
import { openStreamerAccess, type StreamerTokenDeps } from "../accounts/streamer-token.ts"
import type { GiveawayRoom } from "./giveaway-room.ts"
import type { RoomStatus } from "./rows.ts"

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

/** The streamer's token is gone: the sign-in was never stored, or the hourly validation deleted it. */
class StreamerTokenMissing extends Error {}

/** The giveaway has no row in the account store. */
class GiveawayMissing extends Error {}

// Every failure is counted on the room, whose live page shows it; the room logs it with the giveaway id.
async function refreshRoles(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  try {
    const giveaway = await requireGiveaway(deps, giveawayId)
    const token = await deps.accounts.findStreamerToken(giveaway.streamerId)
    if (token === null) throw new StreamerTokenMissing()
    const accessToken = await openStreamerAccess(deps, token)
    const roles = await deps.twitch.channelRoles(accessToken, giveaway.broadcasterId)
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

async function requireGiveaway(deps: StreamerTokenDeps, giveawayId: string): Promise<Giveaway> {
  const giveaway = await deps.accounts.findGiveawayById(giveawayId)
  if (giveaway === null) throw new GiveawayMissing()
  return giveaway
}
