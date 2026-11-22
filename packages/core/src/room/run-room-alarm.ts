import { errorClass } from "../lib/error-class.ts"
import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import { accountAgeDays } from "../domain/rules.ts"
import { providerFor } from "../platform/provider.ts"
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

// A failed profile or giveaway read leaves the whole batch waiting, a failed follow read only that chatter;
// the room's next check a period later asks again, so nothing is thrown here. The block list version the
// account store holds is what the room checks the exclusions against, as for a page entry.
async function checkChatEntrants(
  deps: StreamerTokenDeps,
  giveawayId: string,
  room: GiveawayRoom,
  duty: ChatEntrantsDuty,
): Promise<void> {
  const provider = providerFor(deps.platforms, duty.platform)
  const [giveaway, profiles, follows] = await Promise.allSettled([
    deps.accounts.findGiveawayById(giveawayId),
    provider.userProfiles(duty.chatters.map((chatter) => chatter.platformUserId)),
    readFollows(deps, giveawayId, duty),
  ])
  if (giveaway.status === "rejected") {
    console.warn("chat entry check failed", { giveawayId, errorClass: errorClass(giveaway.reason) })
    return
  }
  if (profiles.status === "rejected") {
    console.warn("chat entry check failed", { giveawayId, errorClass: errorClass(profiles.reason) })
    return
  }
  if (giveaway.value === null) {
    console.warn("chat entry check found no giveaway", { giveawayId })
    return
  }
  const expected = { blockListVersion: giveaway.value.blockListVersion }
  // An unexpected throw of the follow reads leaves every chatter that needs a follow waiting.
  const followOf =
    follows.status === "fulfilled" ? follows.value : new Map<string, boolean | null>()
  if (follows.status === "rejected") {
    console.warn("chat entry follow check failed", {
      giveawayId,
      errorClass: errorClass(follows.reason),
    })
  }
  const now = deps.clock.now()
  const profileOf = new Map(profiles.value.map((profile) => [profile.id, profile]))
  room.enterFromChat(
    duty.chatters.flatMap(({ platformUserId, followerCheck }) => {
      const isFollower = followerCheck ? followOf.get(platformUserId) : false
      if (isFollower === undefined || isFollower === null) return []
      const profile = profileOf.get(platformUserId)
      return [
        {
          platformUserId,
          isFollower,
          accountAgeDays: profile === undefined ? null : accountAgeDays(now, profile.createdAt),
          profileImageUrl: profile?.profileImageUrl ?? null,
        },
      ]
    }),
    expected,
  )
}

// Giveaways whose streamer token lacks the chat entry scopes, logged once per process.
const missingScopeLogged = new Set<string>()

/**
 * The follow of every chatter that needs one: true or false, null when the read failed and the chatter
 * waits for the next check. A token without the chat entry scopes reads no follow: every chatter counts
 * as not following, as the rules treat an unknown follow.
 */
async function readFollows(
  deps: StreamerTokenDeps,
  giveawayId: string,
  duty: ChatEntrantsDuty,
): Promise<ReadonlyMap<string, boolean | null>> {
  const asked = duty.chatters.filter((chatter) => chatter.followerCheck)
  if (asked.length === 0) return new Map()
  const { provider, accessToken, broadcasterId, scopes } = await openGiveawayStreamerAccess(
    deps,
    giveawayId,
  )
  if (!provider.chatEntryScopes.every((scope) => scopes.includes(scope))) {
    if (!missingScopeLogged.has(giveawayId)) {
      missingScopeLogged.add(giveawayId)
      console.warn("chat entry follows not readable", { giveawayId })
    }
    return new Map(asked.map(({ platformUserId }) => [platformUserId, false]))
  }
  const reads = await Promise.allSettled(
    asked.map(({ platformUserId }) =>
      provider.channelFollower(accessToken, broadcasterId, platformUserId),
    ),
  )
  const failed = reads.filter((read) => read.status === "rejected")
  if (failed.length > 0) {
    console.warn("chat entry follow reads failed", {
      giveawayId,
      count: failed.length,
      errorClass: errorClass(failed[0]?.reason),
    })
  }
  return new Map(
    asked.map(({ platformUserId }, index) => {
      const read = reads[index]
      return [platformUserId, read?.status === "fulfilled" ? read.value : null]
    }),
  )
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
