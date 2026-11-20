import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import type { ResolvedConfig } from "@rafflink/core/config"
import { openKeyRing, type KeyRing } from "@rafflink/core/lib/seal"
import { systemRandom } from "@rafflink/core/lib/system-ports"
import type { Clock, Instant } from "@rafflink/core/ports"
import { GiveawayRoom } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import { runRoomAlarm } from "@rafflink/core/room/run-room-alarm"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { startFakeTwitch, users, type RunningFakeTwitch } from "@rafflink/core/test/contract"
import { seedStreamer } from "../test/fake-twitch.ts"
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
let deps: StreamerTokenDeps
let room: GiveawayRoom

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
  accounts = new AccountStore(new BunSqliteAsyncSql(accountsDb), config)
  keyRing = await openKeyRing([sealKey])
  deps = {
    clock,
    random: systemRandom,
    twitch: new TwitchClient(config, fetch),
    accounts,
    keyRing,
  }
  const roomSql = new BunSqliteSyncSql(new Database(":memory:"))
  applyMigrations(roomSql, roomMigrations)
  room = new GiveawayRoom({
    sql: roomSql,
    alarm: { set: () => {}, clear: () => {} },
    live: { broadcast: () => {} },
    clock,
    random: systemRandom,
    config,
  })
  room.init(giveawayInit(giveawayId))
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
    overlayToken: "overlay",
    createdAt: clock.now(),
  })
}

async function seedStreamerAndGiveaway(): Promise<void> {
  await seedStreamer(twitch, deps.twitch, accounts, keyRing, "streamer-1", users.streamer.id)
  await createGiveaway()
}

const viewer = {
  platformUserId: "300",
  login: "vip_viewer",
  displayName: "Vip_Viewer",
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

    expect(room.enter(viewer)).toMatchObject({
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

describe("runRoomAlarm status mirror", () => {
  it("writes the closed status to the account store and clears the pending mirror", async () => {
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.close()
    clock.advance(config.mirrorRetrySeconds * 1000)

    await runRoomAlarm(deps, giveawayId, room)

    expect((await accounts.findGiveawayById(giveawayId))?.status).toBe("closed")
    expect(room.onAlarm().mirrorStatus).toBeNull()
  })

  it("leaves the mirror pending when the account store fails and retries after the delay", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await seedStreamerAndGiveaway()
    await runRoomAlarm(deps, giveawayId, room)
    room.close()
    accountsDb.close()
    clock.advance(config.mirrorRetrySeconds * 1000)

    await runRoomAlarm(deps, giveawayId, room)

    expect(warn).toHaveBeenCalledWith("status mirror failed", {
      giveawayId,
      status: "closed",
      errorClass: "RangeError",
    })
    expect(room.onAlarm().mirrorStatus).toBeNull()
    clock.advance(config.mirrorRetrySeconds * 1000)
    expect(room.onAlarm().mirrorStatus).toBe("closed")
    warn.mockRestore()
  })
})
