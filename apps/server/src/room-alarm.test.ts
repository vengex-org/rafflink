import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { ResolvedConfig } from "@rafflink/core/config"
import { openKeyRing, type KeyRing } from "@rafflink/core/lib/seal"
import { systemRandom } from "@rafflink/core/lib/system-ports"
import type { Clock, Instant } from "@rafflink/core/ports"
import { GiveawayRoom } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import { runRoomAlarm, type RoomAlarmDeps } from "@rafflink/core/room/run-room-alarm"
import { openGiveawayStreamerAccess } from "@rafflink/core/room/streamer-access"
import { StatsStore } from "@rafflink/core/stats/stats-store"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { TwitchProvider } from "@rafflink/core/twitch/twitch-provider"
import {
  FakeBeacon,
  idleChat,
  startFakeTwitch,
  users,
  type RunningFakeTwitch,
} from "@rafflink/core/test/contract"
import {
  chatEntryStreamerScopes,
  pointsEntryStreamerScopes,
  seedStreamer,
} from "../test/fake-twitch.ts"
import { giveawayInit, sealKey, testConfig, validRules } from "../test/fixtures.ts"
import { applyAccountsMigrations, coreAccountsSchemaDir } from "./migrate.ts"

const giveawayId = "0123456789abcdef0123456789abcdef"

class TestClock implements Clock {
  constructor(private at: Instant) {}
  now(): Instant {
    return this.at
  }
  advance(ms: number): void {
    this.at += ms
  }
}

let twitch: RunningFakeTwitch
let config: ResolvedConfig
let clock: TestClock
let accountsDb: Database
let accounts: AccountStore
let keyRing: KeyRing
let deps: RoomAlarmDeps
let room: GiveawayRoom
let roomSql: BunSqliteSyncSql

beforeEach(async () => {
  twitch = startFakeTwitch()
  config = testConfig({
    TWITCH_ID_BASE_URL: twitch.origin,
    TWITCH_HELIX_BASE_URL: twitch.origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
    MIRROR_RETRY_SECONDS: "30",
    LIVE_INTERVAL_MS: "1",
  })
  clock = new TestClock(Date.now())
  accountsDb = new Database(":memory:")
  applyAccountsMigrations(accountsDb, coreAccountsSchemaDir(), clock)
  const accountsSql = new BunSqliteAsyncSql(accountsDb)
  accounts = new AccountStore(accountsSql, config)
  keyRing = await openKeyRing([sealKey])
  deps = {
    clock,
    random: systemRandom,
    platforms: { twitch: new TwitchProvider(new TwitchClient(config, fetch), clock, config) },
    accounts,
    keyRing,
    stats: new StatsStore(accountsSql, config),
  }
  roomSql = new BunSqliteSyncSql(new Database(":memory:"))
  applyMigrations(roomSql, roomMigrations)
  room = new GiveawayRoom({
    sql: roomSql,
    alarm: { set: () => {}, clear: () => {} },
    live: { broadcast: () => {}, broadcastOverlay: () => {}, broadcastViewers: () => {} },
    clock,
    random: systemRandom,
    config,
    chat: idleChat(clock, config),
    beacon: new FakeBeacon(),
  })
  room.init(giveawayInit(giveawayId))
  room.loadExclusions({ blocked: { version: 0, platformUserIds: [] }, recentWinners: [] })
})

afterEach(async () => {
  await twitch.stop()
})

async function createGiveaway(): Promise<void> {
  await accounts.insertGiveaway({
    id: giveawayId,
    code: "ABCDE",
    streamerId: "streamer-1",
    title: "Title",
    prize: "Prize",
    rules: validRules,
    closesAt: null,
    claimSeconds: 300,
    winnerCount: 1,
    overlayToken: "overlay",
    createdAt: clock.now(),
  })
}

async function seedStreamerAndGiveaway(
  scopes: readonly [string, ...string[]] = chatEntryStreamerScopes,
): Promise<void> {
  await seedStreamer(
    twitch,
    new TwitchClient(config, fetch),
    accounts,
    keyRing,
    "streamer-1",
    users.streamer.id,
    scopes,
  )
  await createGiveaway()
}

const viewer = {
  platformUserId: "300",
  login: "vip_viewer",
  displayName: "Vip_Viewer",
  profileImageUrl: null,
  isFollower: false,
  subTier: null,
  accountAgeDays: 100,
} as const

describe("runRoomAlarm role refresh", () => {
  it("fetches the roles with the streamer token so a VIP enters with the VIP tickets", async () => {
    await seedStreamerAndGiveaway()
    twitch.fake.control.addUser({ ...users.viewer, id: "300", login: "vip_viewer" })
    twitch.fake.control.setRole(users.streamer.id, "300", "vip", true)

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.enter(viewer, { blockListVersion: 0 })).toMatchObject({
      kind: "entered",
      entry: { group: "vip", tickets: 6 },
    })
    expect(room.liveSnapshot().roleRefreshFailures).toBe(0)
  })

  it("counts a failed role fetch on the room and logs the failure", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    twitch.fake.control.failNext("vips", 503, 2)

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.liveSnapshot().roleRefreshFailures).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      "room failure",
      expect.objectContaining({ giveawayId, kind: "role-refresh" }),
    )
    warn.mockRestore()
  })

  it("counts a failure when the streamer token was deleted", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    await accounts.deleteStreamerToken("streamer-1")

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.liveSnapshot().roleRefreshFailures).toBe(1)
    warn.mockRestore()
  })

  it("counts a failure when the giveaway is not in the account store", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.liveSnapshot().roleRefreshFailures).toBe(1)
    warn.mockRestore()
  })

  it("does not fetch roles again before the next refresh is due", async () => {
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    const calls = twitch.fake.control.calls.length

    await runRoomAlarm(deps, giveawayId, room)

    expect(twitch.fake.control.calls).toHaveLength(calls)
  })
})

describe("runRoomAlarm commit", () => {
  it("commits a room that closed, so the root and the round exist before anyone draws", async () => {
    room.close(null)
    expect(room.verification().commitment).toBeNull()

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.verification().commitment?.drandRound).toBeGreaterThan(0)
  })

  it("logs a failed commit and still mirrors the status", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.close(null)
    clock.advance(config.mirrorRetrySeconds * 1000)
    const commit = spyOn(room, "commit").mockRejectedValue(new Error("boom"))

    await runRoomAlarm(deps, giveawayId, room)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("room commit failed", { giveawayId, errorClass: "Error" })
    expect((await accounts.findGiveawayById(giveawayId))?.status).toBe("closed")
    commit.mockRestore()
    warn.mockRestore()
  })
})

describe("runRoomAlarm status mirror", () => {
  it("writes the closed status to the account store and clears the pending mirror", async () => {
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.close(null)
    clock.advance(config.mirrorRetrySeconds * 1000)

    await runRoomAlarm(deps, giveawayId, room)

    expect((await accounts.findGiveawayById(giveawayId))?.status).toBe("closed")
    expect(room.onAlarm().mirrorDue).toBe(false)
  })

  it("leaves the mirror pending when the account store fails and retries after the delay", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.close(null)
    accountsDb.close()
    clock.advance(config.mirrorRetrySeconds * 1000)

    await runRoomAlarm(deps, giveawayId, room)

    expect(warn).toHaveBeenCalledWith("status mirror failed", {
      giveawayId,
      status: "closed",
      errorClass: "RangeError",
    })
    expect(room.onAlarm().mirrorDue).toBe(false)
    clock.advance(config.mirrorRetrySeconds * 1000)
    expect(room.onAlarm().mirrorDue).toBe(true)
    warn.mockRestore()
  })
})

describe("runRoomAlarm minute counts", () => {
  it("adds the finished minutes of the room's entries to the account store's counters", async () => {
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.enter(viewer, { blockListVersion: 0 })
    clock.advance(60_000)

    await runRoomAlarm(deps, giveawayId, room)

    expect(accountsDb.query("SELECT SUM(entries) AS total FROM metrics_minute").get()).toEqual({
      total: 1,
    })
  })

  it("logs a lost write and still runs the other duties of the alarm", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.enter(viewer, { blockListVersion: 0 })
    room.close(null)
    accountsDb.run("DROP TABLE metrics_minute")
    clock.advance(60_000)

    await runRoomAlarm(deps, giveawayId, room)

    expect(warn).toHaveBeenCalledWith("room minute counts lost", {
      giveawayId,
      minutes: 1,
      errorClass: "Error",
    })
    expect((await accounts.findGiveawayById(giveawayId))?.status).toBe("closed")
    warn.mockRestore()
  })
})

// The chat of these rooms never delivers a message, so the test queues the chatter the way a keyword message does.
function queueChatter(platformUserId: string): void {
  roomSql.exec(
    "INSERT INTO chat_entry_requests (platform_user_id, login, display_name, sub_tier, vip, moderator, requested_at) VALUES (?, ?, ?, NULL, 0, 0, ?)",
    [platformUserId, `login_${platformUserId}`, `Name_${platformUserId}`, clock.now()],
  )
}

// A redemption of the chosen reward, queued the way the room queues one: no tier, no badges.
function queueRedeemer(platformUserId: string): void {
  roomSql.exec(
    "INSERT INTO chat_entry_requests (platform_user_id, login, display_name, sub_tier, vip, moderator, requested_at, via) VALUES (?, ?, ?, NULL, 0, 0, ?, 'points')",
    [platformUserId, `login_${platformUserId}`, `Name_${platformUserId}`, clock.now()],
  )
}

function callsTo(path: string): number {
  return twitch.fake.control.calls.filter((call) => call.path === path).length
}

describe("runRoomAlarm points entry", () => {
  it("reads the tiers of the redeemers in one call and enters them with their tier", async () => {
    await seedStreamerAndGiveaway(pointsEntryStreamerScopes)
    twitch.fake.control.setSubscription(users.viewer.id, users.streamer.id, "3000")
    queueRedeemer(users.viewer.id)
    queueRedeemer(users.viewer2.id)

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((entrant) => entrant.group)).toEqual([
      "sub_t3",
      "viewer",
    ])
    expect(callsTo("/helix/subscriptions")).toBe(1)
  })

  it("leaves the redeemers waiting when the tier read fails, and enters them at the next check", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway(pointsEntryStreamerScopes)
    twitch.fake.control.setSubscription(users.viewer.id, users.streamer.id, "2000")
    queueRedeemer(users.viewer.id)
    twitch.fake.control.failNext("channel-subscriptions", 500, 1)

    await runRoomAlarm(deps, giveawayId, room)
    const afterFirst = room.summary().entrantCount
    clock.advance(config.chatEntryCheckSeconds * 1000)
    await runRoomAlarm(deps, giveawayId, room)

    expect(afterFirst).toBe(0)
    expect(warn).toHaveBeenCalledWith("chat entry tier check failed", {
      giveawayId,
      errorClass: "TwitchUnavailable",
    })
    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((entrant) => entrant.group)).toEqual([
      "sub_t2",
    ])
    warn.mockRestore()
  })

  it("counts a redeemer as not subscribed when the token lacks the points entry scopes, and logs it once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    twitch.fake.control.setSubscription(users.viewer.id, users.streamer.id, "2000")
    queueRedeemer(users.viewer.id)

    await runRoomAlarm(deps, giveawayId, room)
    queueRedeemer(users.viewer2.id)
    clock.advance(config.chatEntryCheckSeconds * 1000)
    await runRoomAlarm(deps, giveawayId, room)

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((entrant) => entrant.group)).toEqual([
      "viewer",
      "viewer",
    ])
    expect(
      warn.mock.calls.filter(([message]) => message === "points entry tiers not readable"),
    ).toEqual([["points entry tiers not readable", { giveawayId }]])
    expect(callsTo("/helix/subscriptions")).toBe(0)
    warn.mockRestore()
  })
})

describe("runRoomAlarm chat entry", () => {
  it("reads the profile and the follow with the streamer token and enters the chatter", async () => {
    await seedStreamerAndGiveaway()
    twitch.fake.control.setFollowing(users.viewer.id, users.streamer.id, true)
    queueChatter(users.viewer.id)

    await runRoomAlarm(deps, giveawayId, room)

    expect(room.entrants({ afterSeq: 0, limit: 10 })).toEqual([
      {
        seq: 1,
        login: `login_${users.viewer.id}`,
        displayName: `Name_${users.viewer.id}`,
        tickets: validRules.tickets.follower,
        group: "follower",
        profileImageUrl: users.viewer.profileImageUrl,
      },
    ])
  })

  it("logs a failed check and leaves the chatter waiting for the next one", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    queueChatter(users.viewer.id)
    twitch.fake.control.failNext("users", 500, 1)

    await runRoomAlarm(deps, giveawayId, room)

    expect(warn).toHaveBeenCalledWith("chat entry check failed", {
      giveawayId,
      errorClass: "TwitchUnavailable",
    })
    expect(room.summary().entrantCount).toBe(0)
    clock.advance(config.chatEntryCheckSeconds * 1000)
    await runRoomAlarm(deps, giveawayId, room)
    expect(room.summary().entrantCount).toBe(1)
    warn.mockRestore()
  })

  it("leaves a chatter whose follow read failed waiting and enters the others", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    for (const user of [users.viewer, users.viewer2]) {
      twitch.fake.control.setFollowing(user.id, users.streamer.id, true)
      queueChatter(user.id)
    }
    twitch.fake.control.failNext("followers", 500, 1)

    await runRoomAlarm(deps, giveawayId, room)
    const afterFirst = room.summary().entrantCount
    clock.advance(config.chatEntryCheckSeconds * 1000)
    await runRoomAlarm(deps, giveawayId, room)

    expect(afterFirst).toBe(1)
    expect(warn).toHaveBeenCalledWith("chat entry follow reads failed", {
      giveawayId,
      count: 1,
      errorClass: "TwitchUnavailable",
    })
    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((entrant) => entrant.group)).toEqual([
      "follower",
      "follower",
    ])
    warn.mockRestore()
  })

  it("counts every chatter as not following when the token lacks the chat entry scope, and logs it once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway(["openid", "channel:read:vips", "moderation:read"])
    twitch.fake.control.setFollowing(users.viewer.id, users.streamer.id, true)
    queueChatter(users.viewer.id)

    await runRoomAlarm(deps, giveawayId, room)
    queueChatter(users.viewer2.id)
    clock.advance(config.chatEntryCheckSeconds * 1000)
    await runRoomAlarm(deps, giveawayId, room)

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((entrant) => entrant.group)).toEqual([
      "viewer",
      "viewer",
    ])
    expect(
      warn.mock.calls.filter(([message]) => message === "chat entry follows not readable"),
    ).toEqual([["chat entry follows not readable", { giveawayId }]])
    expect(callsTo("/helix/channels/followers")).toBe(0)
    warn.mockRestore()
  })

  it("keeps the streamer's access token between checks instead of refreshing it each time", async () => {
    await seedStreamerAndGiveaway()
    const refreshesBefore = callsTo("/oauth2/token")

    for (const user of [users.viewer, users.viewer2]) {
      queueChatter(user.id)
      await runRoomAlarm(deps, giveawayId, room)
      clock.advance(config.chatEntryCheckSeconds * 1000)
    }

    expect(room.summary().entrantCount).toBe(2)
    expect(callsTo("/helix/channels/followers")).toBe(2)
    // One refresh of the streamer's token and one app token for the profile reads.
    expect(callsTo("/oauth2/token")).toBe(refreshesBefore + 2)
  })

  it("shares one token refresh between callers that overlap", async () => {
    await seedStreamerAndGiveaway()
    const refreshesBefore = callsTo("/oauth2/token")

    const [first, second] = await Promise.all([
      openGiveawayStreamerAccess(deps, giveawayId),
      openGiveawayStreamerAccess(deps, giveawayId),
    ])

    expect(second.accessToken).toBe(first.accessToken)
    expect(callsTo("/oauth2/token")).toBe(refreshesBefore + 1)
  })
})
