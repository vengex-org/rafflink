import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { AccountStore } from "../accounts/account-store.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import { accountsSchema, InProcessRooms, TestClock, validRules } from "../../test/app-fixture.ts"
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
    await accounts.setStatus(id, "closed")
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

    expect(await armRetentionAlarms(accounts, rooms, 10)).toBe(2)

    expect(await accounts.listUnarmedRetention(10)).toEqual([])
    expect(await armRetentionAlarms(accounts, rooms, 10)).toBe(0)
  })

  it("wakes no more rooms than the batch size and finishes the rest on the next run", async () => {
    const { accounts, rooms } = await setup(["g1", "g2", "g3"])

    expect(await armRetentionAlarms(accounts, rooms, 2)).toBe(2)
    expect(await accounts.listUnarmedRetention(10)).toEqual(["g3"])
    expect(await armRetentionAlarms(accounts, rooms, 2)).toBe(1)
  })

  it("keeps a giveaway unmarked when its room fails and still wakes the others", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, rooms } = await setup(["g1", "g2"])
    const open = rooms.get.bind(rooms)
    spyOn(rooms, "get").mockImplementation((id) => {
      if (id === "g1") throw new Error("room unavailable")
      return open(id)
    })

    expect(await armRetentionAlarms(accounts, rooms, 10)).toBe(1)

    expect(await accounts.listUnarmedRetention(10)).toEqual(["g1"])
  })
})
