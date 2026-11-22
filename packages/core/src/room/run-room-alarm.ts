import { errorClass } from "../lib/error-class.ts"
import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import { accountAgeDays } from "../domain/rules.ts"
import { providerFor, type UserProfile } from "../platform/provider.ts"
import type { StatsStore } from "../stats/stats-store.ts"
import type { AlarmDuties, ChatEntrantsDuty, GiveawayRoom } from "./giveaway-room.ts"
import { mirrorStatus } from "./mirror-status.ts"
import { openGiveawayStreamerAccess } from "./streamer-access.ts"

export interface RoomAlarmDeps extends StreamerTokenDeps {
  readonly stats: Pick<StatsStore, "addMinutes">
}

/** What the room's alarm asks of the adapter: the role lists and the chat entrants' checks need Twitch, the commit is asynchronous, the status mirror and the minute counters need the account store. */
export async function runRoomAlarm(
  deps: RoomAlarmDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  const duties = room.onAlarm()
  await addMinutes(deps, giveawayId, duties.metrics)
  if (duties.refreshRoles) await refreshRoles(deps, giveawayId, room)
  if (duties.chatEntrants !== null) {
    await checkChatEntrants(deps, giveawayId, room, duties.chatEntrants)
  }
  if (duties.commit) await commitRoom(giveawayId, room)
  if (duties.draw) await drawRoom(deps, giveawayId, room)
  if (duties.mirrorStatus !== null)
    await mirrorStatus(room, deps.accounts, giveawayId, duties.mirrorStatus, deps.clock.now())
}

// Not retried: the room has moved past these minutes, so a lost write is a gap in the admin chart, logged here.
async function addMinutes(
  deps: RoomAlarmDeps,
  giveawayId: string,
  metrics: AlarmDuties["metrics"],
): Promise<void> {
  if (metrics.length === 0) return
  try {
    await deps.stats.addMinutes(metrics, deps.clock.now())
  } catch (error) {
    console.warn("room minute counts lost", {
      giveawayId,
      minutes: metrics.length,
      errorClass: errorClass(error),
    })
  }
}

// A failed commit stays due in the room, whose alarm retries it with a growing wait until it gives up, so nothing is thrown here.
async function commitRoom(giveawayId: string, room: GiveawayRoom): Promise<void> {
  try {
    await room.commit()
  } catch (error) {
    console.warn("room commit failed", { giveawayId, errorClass: errorClass(error) })
  }
}

// A draw the room could not make stays requested in the room, whose alarm retries it until the round is late, so nothing is thrown here.
async function drawRoom(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  try {
    const outcome = await room.drawFirst(null)
    if (outcome.kind === "drawn")
      await mirrorStatus(room, deps.accounts, giveawayId, "drawn", deps.clock.now())
  } catch (error) {
    console.warn("room draw failed", { giveawayId, errorClass: errorClass(error) })
  }
}

// A failed check leaves the chatters waiting in the room, whose next check a period later asks again, so nothing is thrown here.
async function checkChatEntrants(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
  duty: ChatEntrantsDuty,
): Promise<void> {
  const provider = providerFor(deps.platforms, duty.platform)
  let profiles: readonly UserProfile[]
  let followers: ReadonlySet<string>
  try {
    ;[profiles, followers] = await Promise.all([
      provider.userProfiles(duty.chatters.map((chatter) => chatter.platformUserId)),
      readFollowers(deps, giveawayId, duty),
    ])
  } catch (error) {
    console.warn("chat entry check failed", { giveawayId, errorClass: errorClass(error) })
    return
  }
  const now = deps.clock.now()
  const profileOf = new Map(profiles.map((profile) => [profile.id, profile]))
  room.enterFromChat(
    duty.chatters.map(({ platformUserId }) => {
      const profile = profileOf.get(platformUserId)
      return {
        platformUserId,
        isFollower: followers.has(platformUserId),
        accountAgeDays: profile === undefined ? null : accountAgeDays(now, profile.createdAt),
        profileImageUrl: profile?.profileImageUrl ?? null,
      }
    }),
  )
}

// The streamer's token is opened only when a chatter's follow can change their entry.
async function readFollowers(
  deps: StreamerTokenDeps,
  giveawayId: string,
  duty: ChatEntrantsDuty,
): Promise<ReadonlySet<string>> {
  const asked = duty.chatters.filter((chatter) => chatter.followerCheck)
  if (asked.length === 0) return new Set()
  const { provider, accessToken, broadcasterId } = await openGiveawayStreamerAccess(
    deps,
    giveawayId,
  )
  const follows = await Promise.all(
    asked.map(async ({ platformUserId }) =>
      (await provider.channelFollower(accessToken, broadcasterId, platformUserId))
        ? [platformUserId]
        : [],
    ),
  )
  return new Set(follows.flat())
}

// Every failure is counted on the room, whose live page shows it; the room logs it with the giveaway id.
async function refreshRoles(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
): Promise<void> {
  try {
    const { provider, accessToken, broadcasterId } = await openGiveawayStreamerAccess(
      deps,
      giveawayId,
    )
    const roles = await provider.channelRoles(accessToken, broadcasterId)
    room.replaceRoles(roles.vips, roles.moderators)
  } catch (error) {
    room.recordFailure("role-refresh", error)
  }
}
