import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { AccountStore } from "../accounts/account-store.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import {
  accountsSchema,
  InProcessRooms,
  mirrored,
  TestClock,
  validRules,
} from "../../test/app-fixture.ts"
import { armRetentionAlarms } from "./arm-retention.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
})

afterEach(() => {
  spyOn(console, "warn").mockRestore()
  spyOn(console, "error").mockRestore()
})

async function setup(closedIds: readonly string[]) {
  const db = new Database(":memory:")
  db.exec(accountsSchema)
  const accounts = new AccountStore(new BunSqliteAsyncSql(db), config)
  await accounts.signInStreamer({
    id: "s1",
    platform: "twitch",
    platformUserId: "200",
    login: "streamer",
    displayName: "Streamer",
    profileImageUrl: null,
    sealedRefreshToken: "sealed",
    scopes: "openid",
    now: 1,
  })
  const rooms = new InProcessRooms(new TestClock(0), config)
  for (const [index, id] of closedIds.entries()) {
    await accounts.insertGiveaway({
      id,
      code: `CODE${index}`,
      streamerId: "s1",
      title: null,
      prize: null,
      rules: { ...validRules },
      closesAt: null,
      claimSeconds: 300,
      winnerCount: 1,
      overlayToken: "o",
      createdAt: index,
    })
    await accounts.setStatus(id, mirrored("closed"), 0)
    await rooms.get(id).init({
      id,
      platform: "twitch",
      broadcasterId: "200",
      title: null,
      code: `CODE${index}`,
      rules: { ...validRules },
      claimSeconds: 300,
      winnerCount: 1,
      closesAt: null,
    })
  }
  return { accounts, rooms }
}

describe("armRetentionAlarms", () => {
  it("wakes the rooms of closed giveaways once and marks them", async () => {
    const { accounts, rooms } = await setup(["g1", "g2"])

    expect(await armRetentionAlarms(accounts, rooms, 10, 5)).toBe(2)

    expect(await accounts.listUnarmedRetention(10, 5)).toEqual([])
    expect(await armRetentionAlarms(accounts, rooms, 10, 5)).toBe(0)
  })

  it("wakes no more rooms than the batch size and finishes the rest on the next run", async () => {
    const { accounts, rooms } = await setup(["g1", "g2", "g3"])

    expect(await armRetentionAlarms(accounts, rooms, 2, 5)).toBe(2)
    expect(await accounts.listUnarmedRetention(10, 5)).toEqual(["g3"])
    expect(await armRetentionAlarms(accounts, rooms, 2, 5)).toBe(1)
  })

  it("keeps a giveaway unmarked when its room fails and still wakes the others", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, rooms } = await setup(["g1", "g2"])
    const open = rooms.get.bind(rooms)
    spyOn(rooms, "get").mockImplementation((id) => {
      if (id === "g1") throw new Error("room unavailable")
      return open(id)
    })

    expect(await armRetentionAlarms(accounts, rooms, 10, 5)).toBe(1)

    expect(await accounts.listUnarmedRetention(10, 5)).toEqual(["g1"])
  })

  it("wakes the others first once a room failed, so failing rooms cannot fill the batch", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const { accounts, rooms } = await setup(["g1", "g2", "g3"])
    const open = rooms.get.bind(rooms)
    spyOn(rooms, "get").mockImplementation((id) => {
      if (id === "g1" || id === "g2") throw new Error("room unavailable")
      return open(id)
    })

    expect(await armRetentionAlarms(accounts, rooms, 2, 5)).toBe(0)
    expect(await armRetentionAlarms(accounts, rooms, 2, 5)).toBe(1)

    expect(await accounts.listUnarmedRetention(10, 5)).toEqual(["g2", "g1"])
  })

  it("stops trying a room after the maximum of failed sweeps and logs the give-up once", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { accounts, rooms } = await setup(["g1"])
    const get = spyOn(rooms, "get").mockImplementation(() => {
      throw new Error("room unavailable")
    })

    await armRetentionAlarms(accounts, rooms, 10, 2)
    expect(error).not.toHaveBeenCalled()
    await armRetentionAlarms(accounts, rooms, 10, 2)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith("retention sweep gave up on a room", {
      giveawayId: "g1",
      attempts: 2,
    })
    await armRetentionAlarms(accounts, rooms, 10, 2)

    expect(get).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("does not count a failed mark as a room failure", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, rooms } = await setup(["g1"])
    spyOn(accounts, "markRetentionArmed").mockRejectedValue(new Error("d1 down"))
    const failure = spyOn(accounts, "recordRetentionFailure")

    expect(await armRetentionAlarms(accounts, rooms, 10, 5)).toBe(0)

    expect(failure).not.toHaveBeenCalled()
  })
})
