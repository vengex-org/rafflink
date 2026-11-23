import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { resolveConfig } from "../config.ts"
import { defaultOverlayTheme } from "../domain/overlay-theme.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import { drawLeafPicks, fromFirstPick, drawWinners } from "../lib/draw.ts"
import { quicknet, roundTime } from "../lib/drand.ts"
import { toHex } from "../lib/encoding.ts"
import { leafHash, merkleRoot } from "../lib/merkle.ts"
import type { Alarm, Clock, Instant, LiveHub, Random, SqlRow, SqlValue, SyncSql } from "../ports.ts"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import { FakeBeacon, fakeRandomness } from "../../test/fake-beacon.ts"
import { idleChat } from "../../test/idle-chat.ts"
import {
  GiveawayRoom,
  overlaySnapshot,
  type EntryExpectation,
  type GiveawayInit,
  type RoomExclusions,
  type RoomViewer,
  type ViewerPush,
} from "./giveaway-room.ts"
import { applyMigrations } from "./migrate.ts"
import { roomMigrations } from "./migrations.ts"
import { RoomRowError } from "./rows.ts"
import {
  entrantsAfterSql,
  entryOfSql,
  headSeqSql,
  lastNamesSql,
  recentEntriesCountSql,
  entriesBetweenCountSql,
  lastClaimDeadlineSql,
  lastStandingDeadlineSql,
  undrawnEntrantSql,
} from "./queries.ts"

const baseEnv = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k1",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
  LIVE_INTERVAL_MS: "1000",
  LIVE_LAST_NAMES: "2",
  LIVE_ENTRANTS_PER_PUSH: "2",
  LIVE_RATE_WINDOW_SECONDS: "10",
  ROLE_REFRESH_SECONDS: "300",
  MIRROR_RETRY_SECONDS: "30",
  REROLL_WINDOW_SECONDS: "600",
  // The chat sockets of these tests never answer; the subscribe window must not wake the alarm.
  EVENTSUB_SUBSCRIBE_SECONDS: "100000",
}
const config = resolveConfig(baseEnv)

const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
  excludeRecentWinners: null,
  chatKeyword: null,
  pageEntry: true,
  subEntry: false,
  pointsReward: null,
  minAge: null,
  excludedCountries: null,
  extraTerms: null,
  winnerForm: [],
}

const giveaway: GiveawayInit = {
  id: "g1",
  platform: "twitch",
  broadcasterId: "broadcaster",
  title: "Giveaway",
  code: "ABCDE",
  rules,
  claimSeconds: 300,
  winnerCount: 1,
  closesAt: null,
}

class TestClock implements Clock {
  constructor(private at: Instant) {}
  now(): Instant {
    return this.at
  }
  advance(ms: number): void {
    this.at += ms
  }
}

class TestAlarm implements Alarm {
  at: Instant | null = null
  set(at: Instant): void {
    this.at = at
  }
  clear(): void {
    this.at = null
  }
}

class TestHub implements LiveHub {
  readonly messages: string[] = []
  readonly overlayMessages: string[] = []
  readonly viewerMessages: string[] = []
  broadcast(json: string): void {
    this.messages.push(json)
  }
  broadcastOverlay(json: string): void {
    this.overlayMessages.push(json)
  }
  broadcastViewers(json: string): void {
    this.viewerMessages.push(json)
  }
}

class RecordingSql implements SyncSql {
  readonly statements: { sql: string; params: readonly SqlValue[] }[] = []
  constructor(private readonly inner: SyncSql) {}
  exec(sql: string, params: readonly SqlValue[]): SqlRow[] {
    this.statements.push({ sql, params })
    return this.inner.exec(sql, params)
  }
  transaction<T>(fn: () => T): T {
    return this.inner.transaction(fn)
  }
}

const random: Random = { bytes: (length) => new Uint8Array(length).fill(7) }

const noExclusions: RoomExclusions = {
  blocked: { version: 0, platformUserIds: [] },
  recentWinners: [],
}

// The block list version every room of these tests holds unless a test changes it.
const current: EntryExpectation = { blockListVersion: 0 }

function blockList(version: number, platformUserIds: readonly string[]) {
  return { version, platformUserIds }
}

function viewer(id: string, overrides: Partial<RoomViewer> = {}): RoomViewer {
  return {
    platformUserId: id,
    login: `login${id}`,
    displayName: `Name${id}`,
    profileImageUrl: null,
    isFollower: false,
    subTier: null,
    accountAgeDays: 100,
    ...overrides,
  }
}

function setup(
  init: GiveawayInit = giveaway,
  rng: Random = random,
  env: Record<string, string> = {},
  exclusions: RoomExclusions | null = noExclusions,
) {
  const db = new Database(":memory:")
  const sql = new RecordingSql(new BunSqliteSyncSql(db))
  applyMigrations(sql, roomMigrations)
  const clock = new TestClock(0)
  const alarm = new TestAlarm()
  const hub = new TestHub()
  const beacon = new FakeBeacon()
  const room = new GiveawayRoom({
    sql,
    alarm,
    live: hub,
    clock,
    random: rng,
    config: resolveConfig({ ...baseEnv, ...env }),
    chat: idleChat(clock, config),
    beacon,
  })
  room.init(init)
  if (exclusions !== null) room.loadExclusions(exclusions)
  return { room, sql, clock, alarm, hub, beacon }
}

function advanceToAlarm(clock: TestClock, alarm: TestAlarm): void {
  clock.advance((alarm.at ?? clock.now()) - clock.now())
}

function enterMany(room: GiveawayRoom, ids: readonly string[]): void {
  for (const id of ids) room.enter(viewer(id), current)
}

function picks(sql: SyncSql): SqlRow[] {
  return sql.exec("SELECT n, platform_user_id, rerolled, claimed_via FROM draws ORDER BY n", [])
}

async function drawPicks(room: GiveawayRoom, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await room.draw(1, null)
}

function roundTimeOf(room: GiveawayRoom): Instant {
  const round = room.verification().commitment?.drandRound
  if (round === undefined) throw new Error("room has not committed")
  return roundTime(quicknet, round)
}

function twitch(id: string) {
  return { platform: "twitch", platformUserId: id }
}

async function drawnRoom() {
  const context = setup()
  enterMany(context.room, ["1", "2", "3"])
  context.room.close(null)
  await context.room.draw(1, null)
  const winner = twitch(String(picks(context.sql)[0]?.platform_user_id))
  return { ...context, winner }
}

function plan(sql: SyncSql, statement: string, params: readonly SqlValue[]): string[] {
  return sql.exec(`EXPLAIN QUERY PLAN ${statement}`, params).map((row) => String(row.detail))
}

afterEach(() => {
  spyOn(console, "warn").mockRestore()
})

describe("GiveawayRoom entries", () => {
  it("a second entry keeps the first", () => {
    const { room, sql, clock } = setup()
    clock.advance(1000)
    const first = room.enter(viewer("1"), current)
    clock.advance(5000)
    const second = room.enter(viewer("1", { isFollower: true, subTier: 3 }), current)

    expect(first).toEqual({
      kind: "entered",
      entry: { group: "viewer", tickets: 1, enteredAt: 1000 },
    })
    expect(second).toEqual({
      kind: "already-in",
      entry: { group: "viewer", tickets: 1, enteredAt: 1000 },
    })
    expect(room.summary()).toMatchObject({ entrantCount: 1, ticketTotal: 1 })
    expect(sql.exec("SELECT COUNT(*) AS c FROM entries", [])[0]?.c).toBe(1)
  })

  it("entries after close are refused", () => {
    const { room } = setup()
    expect(room.close(null)).toEqual({ kind: "closed" })

    expect(room.enter(viewer("1"), current)).toEqual({ kind: "closed" })
    expect(room.summary()).toMatchObject({ status: "closed", entrantCount: 0 })
  })

  it("refuses entries from the end time on, before the alarm has run", () => {
    const { room, clock } = setup({ ...giveaway, closesAt: 5000 })
    clock.advance(4999)
    expect(room.enter(viewer("1"), current).kind).toBe("entered")
    clock.advance(1)
    expect(room.enter(viewer("2"), current)).toEqual({ kind: "closed" })
  })

  it("closing twice reports the status the second time", () => {
    const { room } = setup()
    room.close(null)
    expect(room.close(null)).toEqual({ kind: "not-open", status: "closed" })
  })

  it("writes nothing for a viewer who is not eligible", () => {
    const { room, sql } = setup({ ...giveaway, rules: { ...rules, subsOnly: true } })

    expect(room.enter(viewer("1"), current)).toEqual({ kind: "not-eligible", reason: "subs-only" })
    expect(room.enter(viewer("broadcaster", { subTier: 1 }), current)).toEqual({
      kind: "not-eligible",
      reason: "broadcaster",
    })
    expect(room.summary()).toMatchObject({ entrantCount: 0, ticketTotal: 0 })
    expect(sql.exec("SELECT COUNT(*) AS c FROM entries", [])[0]?.c).toBe(0)
  })

  it("gives the tickets of the best group, not their sum", () => {
    const { room } = setup()
    const outcome = room.enter(viewer("1", { isFollower: true, subTier: 2 }), current)
    expect(outcome).toMatchObject({ entry: { group: "sub_t2", tickets: 4 } })
  })

  it("keeps the first room when init runs again", () => {
    const { room } = setup()
    room.enter(viewer("1"), current)
    room.init({ ...giveaway, id: "other", claimSeconds: 10 })
    expect(room.summary()).toMatchObject({ status: "open", entrantCount: 1 })
  })

  it("keeps the counters equal to the entries", () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.enter(viewer("2", { isFollower: true }), current)
    room.enter(viewer("4", { isFollower: true }), current)
    room.close(null)
    room.enter(viewer("5"), current)

    const stored = sql.exec("SELECT COUNT(*) AS c, SUM(tickets) AS t FROM entries", [])[0]
    expect(room.summary()).toMatchObject({ entrantCount: stored?.c, ticketTotal: stored?.t })
    expect(stored).toEqual({ c: 4, t: 5 })
  })

  it("rejects a status and a claim channel the schema does not know", () => {
    const { sql } = setup()
    expect(() => sql.exec("UPDATE room_state SET status = 'paused'", [])).toThrow()
    expect(() =>
      sql.exec(
        "INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until, claimed_at, claimed_via) VALUES (0, 'twitch', '1', 0, 0, 0, 'carrier-pigeon')",
        [],
      ),
    ).toThrow()
  })
})

describe("GiveawayRoom draw", () => {
  it("stores the seed and draws pick 0 of the seeded order", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close(null)

    const outcome = await room.draw(1, null)

    const stored = sql.exec("SELECT seed, status FROM room_state", [])[0]
    expect(stored?.status).toBe("drawn")
    expect(stored?.seed).toEqual(new Uint8Array(32).fill(7))
    const entries = ["1", "2", "3"].map((id) => ({ ...twitch(id), tickets: 1 }))
    const expected = await drawWinners(new Uint8Array(32).fill(7), entries, 1)
    expect(outcome.kind === "drawn" ? outcome.winners : null).toEqual(expected)
    expect(picks(sql).map((row) => row.platform_user_id)).toEqual([expected[0]?.platformUserId])
  })

  it("draws one more pick per call, each the next of the seeded order, past the planned count", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)

    await drawPicks(room, 3)

    expect(room.summary().winnerCount).toBe(1)
    const entries = ["1", "2", "3", "4"].map((id) => ({ ...twitch(id), tickets: 1 }))
    const expected = await drawWinners(new Uint8Array(32).fill(7), entries, 3)
    expect(picks(sql).map((row) => row.platform_user_id)).toEqual(
      expected.map((winner) => winner.platformUserId),
    )
  })

  it("draws the same order when a reroll sits between two draws", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)

    await room.draw(1, null)
    await room.reroll(0, null)
    await room.draw(1, null)

    const entries = ["1", "2", "3", "4"].map((id) => ({ ...twitch(id), tickets: 1 }))
    const expected = await drawWinners(new Uint8Array(32).fill(7), entries, 3)
    expect(picks(sql).map((row) => row.platform_user_id)).toEqual(
      expected.map((winner) => winner.platformUserId),
    )
  })

  it("says so when every entrant is picked, and writes nothing", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2"])
    room.close(null)
    await drawPicks(room, 2)

    expect(await room.draw(1, null)).toEqual({ kind: "no-entrants-left" })
    expect(picks(sql)).toHaveLength(2)
  })

  it("moves a room nobody entered to drawn with no pick on the first draw", async () => {
    const { room, sql } = setup()
    room.close(null)

    expect(await room.draw(1, null)).toEqual({ kind: "no-entrants-left" })
    expect(room.summary().status).toBe("drawn")
    expect(picks(sql)).toEqual([])
  })

  it("stops at the pick limit, rerolled picks counted", async () => {
    const { room, sql } = setup(giveaway, random, { DRAW_MAX_WINNERS: "2" })
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)
    await room.draw(1, null)
    await room.reroll(0, null)

    expect(await room.draw(1, null)).toEqual({ kind: "pick-limit" })
    expect(picks(sql)).toHaveLength(2)
  })

  it("refuses a draw before the room is closed", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1"])
    expect(await room.draw(1, null)).toEqual({ kind: "not-closed" })
    expect(picks(sql)).toEqual([])
    expect(room.summary().status).toBe("open")
  })

  it("lets only one of two simultaneous first draws through", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close(null)

    const outcomes = await Promise.all([room.draw(1, null), room.draw(1, null)])

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual(["drawn", "try-again"])
    expect(sql.exec("SELECT COUNT(*) AS c FROM draws", [])[0]?.c).toBe(1)
  })

  it("lets only one of two simultaneous next draws write the next pick", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)
    await room.draw(1, null)

    const outcomes = await Promise.all([room.draw(1, null), room.draw(1, null)])

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual(["drawn", "try-again"])
    expect(sql.exec("SELECT COUNT(*) AS c FROM draws", [])[0]?.c).toBe(2)
  })

  it("gives a pick drawn after the first a fresh claim time and a fresh chat watch", async () => {
    const { room, sql, clock } = setup()
    enterMany(room, ["1", "2"])
    room.close(null)
    await room.draw(1, null)
    sql.exec("UPDATE room_state SET chat_unavailable = 1", [])
    clock.advance(1000)

    await room.draw(1, null)

    expect(room.summary().chatClaimUnavailable).toBe(false)
    expect(sql.exec("SELECT claim_until FROM draws WHERE n = 1", [])[0]?.claim_until).toBe(301_000)
  })
})

describe("GiveawayRoom batch draw", () => {
  const ids = Array.from({ length: 12 }, (_, index) => String(index + 1))

  async function pickRows(draw: (room: GiveawayRoom) => Promise<unknown>) {
    const { room, sql } = setup()
    enterMany(room, ids)
    room.close(null)
    await draw(room)
    return sql.exec("SELECT n, platform_user_id, leaf_index FROM draws ORDER BY n", [])
  }

  it("writes the same picks as drawing one by one, from the first draw and after a reroll", async () => {
    const batched = await pickRows(async (room) => {
      await room.draw(3, null)
      await room.reroll(1, null)
      await room.draw(4, null)
    })
    const oneByOne = await pickRows(async (room) => {
      await drawPicks(room, 3)
      await room.reroll(1, null)
      await drawPicks(room, 4)
    })

    expect(batched).toHaveLength(8)
    expect(batched).toEqual(oneByOne)
  })

  it("answers with every pick of the batch in order", async () => {
    const { room } = setup()
    enterMany(room, ids)
    room.close(null)
    await room.draw(2, null)

    const outcome = await room.draw(3, null)

    expect(outcome.kind === "drawn" ? outcome.winners.map((winner) => winner.n) : []).toEqual([
      2, 3, 4,
    ])
  })

  it("gives the verify page a batch it replays from the leaves and the seed", async () => {
    const { room } = setup()
    enterMany(room, ids)
    room.close(null)
    await room.draw(5, null)

    const tickets = room.leaves()?.map((leaf) => leaf.tickets) ?? []
    const replay = await drawLeafPicks(new Uint8Array(32).fill(7), tickets, 5, fromFirstPick)
    expect(room.verification().picks).toEqual(
      replay.map((pick) => ({ n: pick.n, leafIndex: pick.leafIndex, rerolled: false })),
    )
  })

  it("rerolls a pick inside a batch with the next pick of the seeded order", async () => {
    const { room, sql } = setup()
    enterMany(room, ids)
    room.close(null)
    await room.draw(4, null)

    const outcome = await room.reroll(2, null)

    const entries = ids.map((id) => ({ ...twitch(id), tickets: 1 }))
    const expected = await drawWinners(new Uint8Array(32).fill(7), entries, 5)
    expect(outcome).toMatchObject({ kind: "rerolled", replaced: 2, winner: expected[4] })
    expect(picks(sql).map((row) => row.rerolled)).toEqual([0, 0, 1, 0, 0])
  })

  it("stops a batch at the last entrant", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close(null)
    await room.draw(1, null)

    const outcome = await room.draw(5, null)

    expect(outcome.kind === "drawn" ? outcome.winners : []).toHaveLength(2)
    expect(picks(sql)).toHaveLength(3)
  })

  it("refuses a whole batch that would pass the pick limit, and writes none of it", async () => {
    const { room, sql } = setup(giveaway, random, { DRAW_MAX_WINNERS: "3" })
    enterMany(room, ids)
    room.close(null)
    await room.draw(2, null)

    expect(await room.draw(2, null)).toEqual({ kind: "pick-limit" })
    expect(picks(sql)).toHaveLength(2)
    expect(await room.draw(1, null)).toMatchObject({ kind: "drawn" })
  })

  it("tells the live page how many picks the limit still allows, rerolled ones counted, and hides it from the overlay", async () => {
    const { room } = setup(giveaway, random, { DRAW_MAX_WINNERS: "5" })
    enterMany(room, ids)
    room.close(null)
    await room.draw(2, null)
    await room.reroll(0, null)

    expect(room.liveSnapshot().picksLeft).toBe(2)
    expect(overlaySnapshot(room.liveSnapshot())).not.toHaveProperty("picksLeft")
  })

  it("sends the picture of the newest picks only, so a large batch keeps the push small", async () => {
    const { room } = setup(giveaway, random, { LIVE_WINNER_IMAGES: "2" })
    for (const id of ids) room.enter(viewer(id, { profileImageUrl: `https://pic/${id}` }), current)
    room.close(null)
    await room.draw(5, null)

    const images = room.liveSnapshot().winners.map((winner) => winner.profileImageUrl)
    expect(images.slice(0, 3)).toEqual([null, null, null])
    expect(images.slice(3).every((url) => url?.startsWith("https://pic/"))).toBe(true)
  })

  it("refuses a first batch larger than the pick limit and leaves the room closed", async () => {
    const { room, sql } = setup(giveaway, random, { DRAW_MAX_WINNERS: "3" })
    enterMany(room, ids)
    room.close(null)

    expect(await room.draw(4, null)).toEqual({ kind: "pick-limit" })
    expect(room.summary().status).toBe("closed")
    expect(picks(sql)).toEqual([])
  })

  it("draws the requested batch once the round is published", async () => {
    const { room, sql, clock } = setup()
    clock.advance(genesisMs)
    enterMany(room, ids)
    room.requestDraw(4, null)
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())

    expect(room.onAlarm().draw).toBe(true)
    expect((await room.drawFirst(null)).kind).toBe("drawn")
    expect(picks(sql).map((row) => row.n)).toEqual([0, 1, 2, 3])
  })

  it("drops a requested batch over the pick limit, so the alarm stops trying it", async () => {
    const { room, sql, clock } = setup()
    clock.advance(genesisMs)
    enterMany(room, ids)
    room.requestDraw(4, null)
    sql.exec("UPDATE room_state SET draw_count = ?", [config.drawMaxWinners + 1])
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())

    expect(room.onAlarm().draw).toBe(true)
    expect(await room.drawFirst(null)).toEqual({ kind: "pick-limit" })
    expect(room.liveSnapshot().drawRequested).toBe(false)
    expect(room.onAlarm().draw).toBe(false)
    expect(picks(sql)).toEqual([])
  })

  it("keeps the batch of a press made before the round was published", async () => {
    const { room, sql, clock, beacon } = setup()
    clock.advance(genesisMs)
    enterMany(room, ids)
    room.close(null)
    beacon.answer = "not-yet"

    expect((await room.draw(3, null)).kind).toBe("round-pending")
    beacon.answer = "round"
    clock.advance(roundTimeOf(room) + 500 - clock.now())
    expect(room.onAlarm().draw).toBe(true)
    expect((await room.drawFirst(null)).kind).toBe("drawn")
    expect(picks(sql)).toHaveLength(3)
  })
})

describe("GiveawayRoom requested draw", () => {
  it("closes an open room and keeps the request until the round is published", async () => {
    const { room, clock, alarm } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1", "2"])

    expect(room.requestDraw(1, null)).toEqual({ kind: "requested" })
    expect(room.summary().status).toBe("closed")
    expect(room.liveSnapshot().drawRequested).toBe(true)
    expect(room.requestDraw(1, null)).toEqual({ kind: "not-open", status: "closed" })

    expect(room.onAlarm()).toMatchObject({ commit: true, draw: false })
    room.markMirrored(room.mirrorState())
    clock.advance(config.liveIntervalMs)
    await room.commit()
    expect(alarm.at).toBe(roundTimeOf(room) + 500)
  })

  it("asks for the draw from the round time on and draws once the round is there", async () => {
    const { room, clock, sql } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1", "2"])
    room.requestDraw(1, null)
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())

    expect(room.onAlarm()).toMatchObject({ draw: true })
    expect((await room.draw(1, null)).kind).toBe("drawn")

    expect(room.summary().status).toBe("drawn")
    expect(room.liveSnapshot().drawRequested).toBe(false)
    expect(picks(sql)).toHaveLength(1)
  })

  it("tries again every drand period while the round is late and gives up after the publish margin", async () => {
    const { room, clock, alarm } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.requestDraw(1, null)
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())

    expect(room.onAlarm().draw).toBe(true)
    expect(alarm.at).toBe(roundTimeOf(room) + 500 + config.drandPeriodSeconds * 1000)

    clock.advance(config.drandPublishMarginSeconds * 1000 + 1)
    expect(room.onAlarm().draw).toBe(false)
    expect(room.liveSnapshot().drawRequested).toBe(false)
    expect(room.summary().status).toBe("closed")
  })

  it("keeps the next try where it was when other writes rearm the alarm in between", async () => {
    const { room, clock, alarm } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.requestDraw(1, null)
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())
    room.onAlarm()
    const nextTry = alarm.at

    clock.advance(1000)
    room.init(giveaway)
    room.setWinnerCount(2)

    expect(alarm.at).toBe(nextTry)
    clock.advance((nextTry ?? 0) - clock.now())
    expect(room.onAlarm().draw).toBe(true)
  })

  it("pushes the live page when it gives up on a late round", async () => {
    const { room, clock, hub } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.requestDraw(1, null)
    await room.commit()
    clock.advance(roundTimeOf(room) - clock.now() + config.drandPublishMarginSeconds * 1000 + 1)
    const before = hub.messages.length

    room.onAlarm()

    expect(hub.messages.length).toBeGreaterThan(before)
    expect(hub.messages.at(-1)).toContain('"drawRequested":false')
  })

  it("stops showing a request once the commit gave up, and pushes it", async () => {
    const { room, clock, hub } = setup(giveaway, random, { COMMIT_MAX_ATTEMPTS: "1" })
    enterMany(room, ["1"])
    room.requestDraw(1, null)
    expect(room.liveSnapshot().drawRequested).toBe(true)
    expect(room.onAlarm().commit).toBe(true)
    clock.advance(config.commitRetrySeconds * 1000)

    expect(room.onAlarm().commit).toBe(false)

    expect(room.liveSnapshot().drawRequested).toBe(false)
    expect(hub.messages.at(-1)).toContain('"drawRequested":false')
  })

  it("stops showing a request once the entries were deleted", async () => {
    const { room, clock } = setup()
    enterMany(room, ["1"])
    room.requestDraw(1, null)
    await room.commit()
    clock.advance(config.entryRetentionSeconds * 1000)
    room.onAlarm()

    expect(room.liveSnapshot().drawRequested).toBe(false)
  })

  it("draws from a new room instance over the same storage, at the round time plus a short lag", async () => {
    const { room, sql, clock, alarm } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1", "2"])
    room.requestDraw(1, null)
    await room.commit()
    const evicted = new GiveawayRoom({
      sql,
      alarm,
      live: new TestHub(),
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })

    evicted.markMirrored(evicted.mirrorState())
    expect(alarm.at).toBe(roundTimeOf(room) + 500)
    advanceToAlarm(clock, alarm)

    expect(evicted.onAlarm().draw).toBe(true)
    expect((await evicted.drawFirst(null)).kind).toBe("drawn")
  })

  it("draws only pick 0 for the alarm: a drawn room is refused", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2"])
    room.close(null)
    await room.draw(1, null)

    expect(await room.drawFirst(null)).toEqual({ kind: "try-again" })
    expect(picks(sql)).toHaveLength(1)
  })

  it("is set by a draw that finds the round missing, so the alarm draws it", async () => {
    const { room, clock, beacon } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.close(null)
    beacon.answer = "not-yet"

    expect((await room.draw(1, null)).kind).toBe("round-pending")

    expect(room.liveSnapshot().drawRequested).toBe(true)
  })

  it("is not set by a draw after the beacon failed for good", async () => {
    const { room, clock, beacon } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.close(null)
    await room.commit()
    beacon.answer = "unavailable"

    expect(await room.draw(1, null)).toEqual({ kind: "beacon-unavailable" })
    expect(room.liveSnapshot().drawRequested).toBe(false)
  })
})

describe("GiveawayRoom picks", () => {
  it("lists every pick with its identity, rerolled ones included", async () => {
    const { room, winner } = await drawnRoom()
    await room.reroll(0, null)

    const [first, second] = room.picks()

    expect(room.picks()).toHaveLength(2)
    expect(first).toMatchObject({ n: 0, ...winner, claim: { state: "rerolled" } })
    expect(second).toMatchObject({ n: 1, claim: { state: "waiting" } })
  })
})

describe("GiveawayRoom reroll", () => {
  it("rerolls in a room that already holds 800,000 picks", async () => {
    const { room, sql } = await drawnRoom()
    sql.exec(
      `WITH RECURSIVE filler (i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM filler WHERE i < 800099)
       INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until)
       SELECT i, 'twitch', 'filler-' || i, 0, 0 FROM filler`,
      [],
    )

    const outcome = await room.reroll(0, null)

    expect(outcome).toMatchObject({ kind: "rerolled", replaced: 0, winner: { n: 800_100 } })
  })

  it("reroll adds the next pick and marks the old one", async () => {
    const { room, sql } = await drawnRoom()
    const first = picks(sql)[0]

    const outcome = await room.reroll(0, null)

    expect(outcome).toMatchObject({ kind: "rerolled", replaced: 0, winner: { n: 1 } })
    const stored = picks(sql)
    expect(stored).toHaveLength(2)
    expect(stored[0]).toMatchObject({
      n: 0,
      rerolled: 1,
      platform_user_id: first?.platform_user_id,
    })
    expect(stored[1]).toMatchObject({ n: 1, rerolled: 0 })
    expect(stored[1]?.platform_user_id).not.toBe(first?.platform_user_id)
  })

  it("never picks an earlier or rerolled entrant again", async () => {
    const { room, sql } = await drawnRoom()
    await room.reroll(0, null)
    await room.reroll(1, null)
    expect(await room.reroll(2, null)).toEqual({ kind: "no-entrants-left" })

    const ids = picks(sql).map((row) => row.platform_user_id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toHaveLength(3)
  })

  it("a second reroll of the same pick adds nothing", async () => {
    const { room, sql } = await drawnRoom()
    await room.reroll(0, null)

    expect(await room.reroll(0, null)).toEqual({ kind: "already-rerolled" })
    expect(picks(sql)).toHaveLength(2)
  })

  it("two simultaneous rerolls of one pick give one new pick", async () => {
    const { room, sql } = await drawnRoom()

    const outcomes = await Promise.all([room.reroll(0, null), room.reroll(0, null)])

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual([
      "already-rerolled",
      "rerolled",
    ])
    expect(picks(sql)).toHaveLength(2)
  })

  it("keeps a claimed pick and refuses to reroll it", async () => {
    const { room, sql } = await drawnRoom()
    const winnerId = String(picks(sql)[0]?.platform_user_id)
    room.claim(0, twitch(winnerId), "rafflink", null)

    expect(await room.reroll(0, null)).toEqual({ kind: "already-claimed" })
    expect(picks(sql)).toHaveLength(1)
  })

  it("refuses a reroll before a draw and for a pick that does not exist", async () => {
    const closed = setup()
    closed.room.close(null)
    expect(await closed.room.reroll(0, null)).toEqual({ kind: "not-drawn" })

    const { room } = await drawnRoom()
    expect(await room.reroll(9, null)).toEqual({ kind: "unknown-pick" })
  })
})

describe("GiveawayRoom claim", () => {
  it("lets the first claim win and refuses the second", async () => {
    const { room, sql, winner } = await drawnRoom()

    expect(room.claim(0, winner, "rafflink", null)).toEqual({ kind: "claimed" })
    expect(room.claim(0, winner, "chat", null)).toEqual({ kind: "already-claimed" })
    expect(picks(sql)[0]?.claimed_via).toBe("rafflink")
  })

  it("records the channel a claim came through", async () => {
    const { room, sql, winner } = await drawnRoom()
    room.claim(0, winner, "manual", null)
    expect(picks(sql)[0]?.claimed_via).toBe("manual")
  })

  it("refuses a claim after the deadline and accepts it on the deadline", async () => {
    const late = await drawnRoom()
    late.clock.advance(300_001)
    expect(late.room.claim(0, late.winner, "rafflink", null)).toEqual({ kind: "expired" })
    expect(picks(late.sql)[0]?.claimed_via).toBeNull()

    const onTime = await drawnRoom()
    onTime.clock.advance(300_000)
    expect(onTime.room.claim(0, onTime.winner, "rafflink", null)).toEqual({ kind: "claimed" })
  })

  it("lets the streamer mark a claim by hand after the claim time and refuses it twice", async () => {
    const { room, sql, winner, clock } = await drawnRoom()
    clock.advance(300_001)

    expect(room.claim(0, winner, "manual", null)).toEqual({ kind: "claimed" })
    expect(room.claim(0, winner, "manual", null)).toEqual({ kind: "already-claimed" })
    expect(picks(sql)[0]?.claimed_via).toBe("manual")
  })

  it("refuses a claim on a rerolled pick even by hand", async () => {
    const { room, winner, clock } = await drawnRoom()
    await room.reroll(0, null)
    clock.advance(300_001)
    expect(room.claim(0, winner, "manual", null)).toEqual({ kind: "rerolled" })
  })

  it("refuses a claim by someone who was not picked", async () => {
    const { room, winner } = await drawnRoom()
    const other = twitch(winner.platformUserId === "1" ? "2" : "1")
    expect(room.claim(0, other, "rafflink", null)).toEqual({ kind: "not-a-winner" })
    expect(room.claim(7, winner, "rafflink", null)).toEqual({ kind: "not-a-winner" })
  })

  it("refuses a claim on a rerolled pick", async () => {
    const { room, winner } = await drawnRoom()
    await room.reroll(0, null)
    expect(room.claim(0, winner, "rafflink", null)).toEqual({ kind: "rerolled" })
  })
})

describe("GiveawayRoom actors", () => {
  it("keeps who closed, drew, rerolled and marked a claim, and leaves them out of the overlay", async () => {
    const { room } = setup()
    enterMany(room, ["1", "2", "3"])

    room.close("mod:link1")
    await room.draw(1, "streamer")
    await room.reroll(0, "mod:link1")
    const [, second] = room.picks()
    if (second === undefined) throw new Error("the reroll added no pick")
    room.claim(1, second, "manual", "mod:link1")

    expect(room.liveSnapshot().actors).toEqual({
      closedBy: "mod:link1",
      picks: [
        { n: 0, drawnBy: "streamer", rerolledBy: "mod:link1", claimMarkedBy: null },
        { n: 1, drawnBy: "mod:link1", rerolledBy: null, claimMarkedBy: "mod:link1" },
      ],
    })
    expect(Object.hasOwn(overlaySnapshot(room.liveSnapshot()), "actors")).toBe(false)
  })

  it("names nobody for the end time's close and for a claim the winner made", async () => {
    const { room, clock } = setup({ ...giveaway, closesAt: 1000 })
    enterMany(room, ["1"])
    clock.advance(1000)
    room.onAlarm()
    expect(room.summary().status).toBe("closed")
    expect((await room.draw(1, "streamer")).kind).toBe("drawn")
    const [pick] = room.picks()
    if (pick === undefined) throw new Error("the draw added no pick")
    room.claim(0, pick, "rafflink", "streamer")

    expect(room.liveSnapshot().actors).toEqual({
      closedBy: null,
      picks: [{ n: 0, drawnBy: "streamer", rerolledBy: null, claimMarkedBy: null }],
    })
  })

  it("gives the alarm's first pick to whoever pressed Draw while entries were open", async () => {
    const { room, clock } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1", "2"])
    room.requestDraw(1, "mod:link2")
    await room.commit()
    clock.advance(roundTimeOf(room) + 500 - clock.now())

    expect((await room.drawFirst(null)).kind).toBe("drawn")
    expect(room.liveSnapshot().actors).toEqual({
      closedBy: "mod:link2",
      picks: [{ n: 0, drawnBy: "mod:link2", rerolledBy: null, claimMarkedBy: null }],
    })
  })
})

describe("GiveawayRoom roles", () => {
  it("gives a VIP the VIP tickets once the list is stored", () => {
    const { room } = setup()
    room.replaceRoles(["7"], ["8"])

    expect(room.enter(viewer("7"), current)).toMatchObject({ entry: { group: "vip", tickets: 6 } })
    expect(room.enter(viewer("8"), current)).toMatchObject({
      entry: { group: "moderator", tickets: 7 },
    })
  })

  it("replaces more than one chunk of roles within the bound parameter limit", () => {
    const { room, sql } = setup()
    const vips = Array.from({ length: 40 }, (_, index) => `v${index}`)
    const moderators = Array.from({ length: 30 }, (_, index) => `m${index}`)

    room.replaceRoles(vips, moderators)

    const inserts = sql.statements.filter((statement) =>
      statement.sql.startsWith("INSERT INTO channel_roles"),
    )
    expect(inserts).toHaveLength(3)
    expect(Math.max(...inserts.map((statement) => statement.params.length))).toBe(100)
    expect(sql.exec("SELECT COUNT(*) AS c FROM channel_roles", [])[0]?.c).toBe(70)
  })

  it("keeps the old lists when a later chunk fails", () => {
    const { room, sql } = setup()
    room.replaceRoles(["old"], [])
    const vips = Array.from({ length: 40 }, (_, index) => `v${index}`)
    vips[30] = "v0"

    expect(() => room.replaceRoles(vips, [])).toThrow()

    expect(sql.exec("SELECT platform_user_id FROM channel_roles", [])).toEqual([
      { platform_user_id: "old" },
    ])
  })

  it("replaces a list with an empty one", () => {
    const { room, sql } = setup()
    room.replaceRoles(["a"], ["b"])
    room.replaceRoles([], [])
    expect(sql.exec("SELECT COUNT(*) AS c FROM channel_roles", [])[0]?.c).toBe(0)
  })
})

describe("GiveawayRoom exclusions", () => {
  it("reports the exclusions and the block list version, also on a repeated init", () => {
    const { room } = setup(giveaway, random, {}, null)
    expect(room.init(giveaway)).toEqual({ exclusionsLoaded: false, blockListVersion: 0 })

    room.loadExclusions({ blocked: blockList(3, []), recentWinners: [] })

    expect(room.init(giveaway)).toEqual({ exclusionsLoaded: true, blockListVersion: 3 })
  })

  it("refuses every entry until the exclusions are written, and writes nothing", () => {
    const { room } = setup(giveaway, random, {}, null)

    expect(room.enter(viewer("1"), current)).toEqual({
      kind: "unavailable",
      missing: "exclusions",
    })
    expect(room.summary().entrantCount).toBe(0)

    room.loadExclusions(noExclusions)
    expect(room.enter(viewer("1"), current)).toMatchObject({ kind: "entered" })
  })

  it("refuses an entry that expects a newer block list than the room holds", () => {
    const { room } = setup()

    expect(room.enter(viewer("1"), { blockListVersion: 1 })).toEqual({
      kind: "unavailable",
      missing: "block-list",
    })

    room.replaceBlocked(blockList(1, []))
    expect(room.enter(viewer("1"), { blockListVersion: 1 })).toMatchObject({ kind: "entered" })
  })

  it("refuses a blocked account and a recent winner with their own reasons", () => {
    const { room } = setup()
    room.loadExclusions({ blocked: blockList(0, ["7"]), recentWinners: ["8"] })

    expect(room.enter(viewer("7"), current)).toEqual({ kind: "not-eligible", reason: "blocked" })
    expect(room.enter(viewer("8"), current)).toEqual({
      kind: "not-eligible",
      reason: "recent-winner",
    })
    expect(room.enter(viewer("9"), current)).toMatchObject({ kind: "entered" })
    expect(room.summary().entrantCount).toBe(1)
  })

  it("tells a blocked recent winner they are blocked", () => {
    const { room } = setup()
    room.loadExclusions({ blocked: blockList(0, ["7"]), recentWinners: ["7"] })
    expect(room.enter(viewer("7"), current)).toEqual({ kind: "not-eligible", reason: "blocked" })
  })

  it("refuses a known chat bot by its login in any case", () => {
    const { room } = setup(giveaway, random, { CHAT_BOT_LOGINS: "nightbot" })
    expect(room.enter(viewer("7", { login: "NightBot" }), current)).toEqual({
      kind: "not-eligible",
      reason: "blocked",
    })
    expect(room.enter(viewer("8", { login: "viewer" }), current)).toMatchObject({
      kind: "entered",
    })
  })

  it("replaces the block list and keeps the recent winners", () => {
    const { room } = setup()
    room.loadExclusions({ blocked: blockList(0, ["7"]), recentWinners: ["8"] })

    room.replaceBlocked(blockList(1, ["9"]))

    expect(room.enter(viewer("7"), current)).toMatchObject({ kind: "entered" })
    expect(room.enter(viewer("8"), current)).toEqual({
      kind: "not-eligible",
      reason: "recent-winner",
    })
    expect(room.enter(viewer("9"), current)).toEqual({ kind: "not-eligible", reason: "blocked" })
  })

  it("keeps a newer block list when an older one arrives late, also through a load", () => {
    const { room } = setup()
    room.replaceBlocked(blockList(2, ["9"]))

    room.replaceBlocked(blockList(1, ["7"]))
    room.loadExclusions({ blocked: blockList(1, ["7"]), recentWinners: ["8"] })

    expect(room.enter(viewer("7"), current)).toMatchObject({ kind: "entered" })
    expect(room.enter(viewer("9"), current)).toEqual({ kind: "not-eligible", reason: "blocked" })
    expect(room.enter(viewer("8"), current)).toEqual({
      kind: "not-eligible",
      reason: "recent-winner",
    })
  })

  it("loads the recent winners again over the ones loaded before", () => {
    const { room } = setup()
    room.loadExclusions({ blocked: blockList(0, []), recentWinners: ["8"] })
    room.loadExclusions(noExclusions)
    expect(room.enter(viewer("8"), current)).toMatchObject({ kind: "entered" })
  })

  it("writes a long block list in chunks within the bound parameter limit", () => {
    const { room, sql } = setup()
    const blocked = Array.from({ length: 70 }, (_, index) => `b${index}`)

    room.replaceBlocked(blockList(1, blocked))

    const inserts = sql.statements.filter((statement) =>
      statement.sql.startsWith("INSERT INTO excluded_users"),
    )
    expect(inserts).toHaveLength(3)
    expect(Math.max(...inserts.map((statement) => statement.params.length))).toBeLessThanOrEqual(
      100,
    )
    expect(count(sql, "excluded_users")).toBe(70)
  })

  it("removes the entry of an account blocked while entries are open, with its tickets", () => {
    const { room, hub, clock } = setup()
    room.enter(viewer("7", { isFollower: true }), current)
    room.enter(viewer("8"), current)
    clock.advance(config.liveIntervalMs)
    const before = hub.messages.length

    room.replaceBlocked(blockList(1, ["7"]))

    expect(room.entryOf(twitch("7"))).toBeNull()
    expect(room.summary()).toMatchObject({ entrantCount: 1, ticketTotal: 1 })
    expect(room.enter(viewer("7"), { blockListVersion: 1 })).toEqual({
      kind: "not-eligible",
      reason: "blocked",
    })
    expect(room.enter(viewer("9"), { blockListVersion: 1 })).toMatchObject({ kind: "entered" })
    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((row) => row.seq)).toEqual([2, 3])
    expect(hub.messages.length).toBeGreaterThan(before)
  })

  it("keeps the entry of an account blocked after entries closed", () => {
    const { room } = setup()
    room.enter(viewer("7"), current)
    room.close(null)

    room.replaceBlocked(blockList(1, ["7"]))

    expect(room.entryOf(twitch("7"))).not.toBeNull()
    expect(room.summary().entrantCount).toBe(1)
  })
})

describe("GiveawayRoom alarm", () => {
  it("closes the room at the end time and asks for a status mirror", () => {
    const { room, clock, alarm } = setup({ ...giveaway, closesAt: 5000 })
    expect(room.onAlarm()).toEqual({
      refreshRoles: true,
      mirrorDue: false,
      commit: false,
      draw: false,
      metrics: [],
      chatEntrants: null,
    })
    room.replaceRoles([], [])
    expect(alarm.at).toBe(5000)

    clock.advance(5000)
    const duties = room.onAlarm()

    expect(room.summary().status).toBe("closed")
    expect(duties).toEqual({
      refreshRoles: false,
      mirrorDue: true,
      commit: true,
      draw: false,
      metrics: [],
      chatEntrants: null,
    })
    expect(room.enter(viewer("1"), current)).toEqual({ kind: "closed" })
  })

  it("does not close before the end time", () => {
    const { room, clock } = setup({ ...giveaway, closesAt: 5000 })
    clock.advance(4999)
    room.onAlarm()
    expect(room.summary().status).toBe("open")
  })

  it("asks for a role refresh when entries open and again after the refresh period", () => {
    const { room, clock, alarm } = setup()
    expect(alarm.at).toBe(0)
    expect(room.onAlarm().refreshRoles).toBe(true)
    expect(alarm.at).toBe(300_000)

    clock.advance(300_000)
    expect(room.onAlarm().refreshRoles).toBe(true)
  })

  it("stops asking for roles once the room is closed", () => {
    const { room, clock } = setup()
    room.close(null)
    clock.advance(300_000)
    expect(room.onAlarm().refreshRoles).toBe(false)
  })

  it("retries a pending mirror after the retry delay until it is marked", async () => {
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    clock.advance(config.liveIntervalMs)
    await room.commit()
    expect(room.onAlarm().mirrorDue).toBe(false)
    expect(alarm.at).toBe(30_000)

    clock.advance(30_000)
    expect(room.onAlarm().mirrorDue).toBe(true)
    room.markMirrored(room.mirrorState())
    clock.advance(30_000)
    expect(room.onAlarm().mirrorDue).toBe(false)
    expect(alarm.at).toBeNull()
  })

  it("keeps a newer status pending when an older one was mirrored", async () => {
    const { room, clock } = setup()
    enterMany(room, ["1"])
    room.close(null)
    const closed = room.mirrorState()
    await room.draw(1, null)

    room.markMirrored(closed)
    clock.advance(30_000)

    expect(closed.status).toBe("closed")
    expect(room.onAlarm().mirrorDue).toBe(true)
  })

  it("mirrors the entrant count and the picks that were not rerolled", async () => {
    const { room } = await drawnRoom()
    await room.draw(1, null)
    await room.reroll(0, null)

    expect(room.mirrorState()).toEqual({
      status: "drawn",
      entrantCount: 3,
      winners: 2,
      claimed: 0,
      delivered: 0,
    })
  })

  it("mirrors the claimed picks and the delivered prizes", async () => {
    const { room, winner } = await drawnRoom()
    await room.draw(1, null)
    room.claim(0, winner, "rafflink", null)
    room.markDelivered(0)

    expect(room.mirrorState()).toMatchObject({ winners: 2, claimed: 1, delivered: 1 })
  })

  it("keeps newer counts pending when older ones were mirrored", async () => {
    const { room, clock } = await drawnRoom()
    const one = room.mirrorState()
    await room.draw(1, null)

    room.markMirrored(one)
    clock.advance(30_000)

    expect(room.onAlarm().mirrorDue).toBe(true)
  })

  type Drawn = Awaited<ReturnType<typeof drawnRoom>>
  const claimFirst = ({ room, winner }: Drawn) => room.claim(0, winner, "rafflink", null)
  for (const [name, before, change] of [
    ["a reroll", null, ({ room }: Drawn) => room.reroll(0, null)],
    ["a later draw", null, ({ room }: Drawn) => room.draw(1, null)],
    ["a claim", null, claimFirst],
    ["a delivery", claimFirst, ({ room }: Drawn) => room.markDelivered(0)],
  ] as const) {
    it(`asks for a mirror after ${name} in a drawn room, until marked`, async () => {
      const context = await drawnRoom()
      const { room, clock } = context
      before?.(context)
      room.markMirrored(room.mirrorState())
      clock.advance(30_000)
      expect(room.onAlarm().mirrorDue).toBe(false)

      await change(context)
      clock.advance(30_000)
      const due = room.onAlarm().mirrorDue
      room.markMirrored(room.mirrorState())
      clock.advance(30_000)

      expect(due).toBe(true)
      expect(room.onAlarm().mirrorDue).toBe(false)
    })
  }
})

describe("GiveawayRoom live push", () => {
  it("pushes at most once per interval and sends the held update when the alarm fires", () => {
    const { room, clock, hub, alarm } = setup()
    room.replaceRoles([], [])

    room.enter(viewer("1"), current)
    clock.advance(100)
    room.enter(viewer("2"), current)
    clock.advance(100)
    room.enter(viewer("3"), current)

    expect(hub.messages).toHaveLength(1)
    expect(JSON.parse(hub.messages[0] ?? "")).toMatchObject({ entrantCount: 1 })
    expect(alarm.at).toBe(1000)

    clock.advance(800)
    room.onAlarm()
    expect(hub.messages).toHaveLength(2)
    expect(JSON.parse(hub.messages[1] ?? "")).toMatchObject({ entrantCount: 3 })

    clock.advance(10)
    room.enter(viewer("4"), current)
    expect(hub.messages).toHaveLength(2)
  })

  it("pushes again once the interval has passed", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"), current)
    clock.advance(1000)
    room.enter(viewer("2"), current)
    expect(hub.messages).toHaveLength(2)
  })

  it("still updates the alarm when the push fails", () => {
    const { room, alarm, hub } = setup({ ...giveaway, closesAt: 9000 })
    room.replaceRoles([], [])
    spyOn(console, "warn").mockImplementation(() => {})
    spyOn(hub, "broadcast").mockImplementation(() => {
      throw new Error("socket gone")
    })

    room.enter(viewer("1"), current)

    expect(alarm.at).toBe(9000)
    expect(room.summary().entrantCount).toBe(1)
  })

  it("shows the newest names, the rate, the winners and the failure counters", async () => {
    const { room, clock } = setup()
    spyOn(console, "warn").mockImplementation(() => {})
    for (const id of ["1", "2", "3"]) {
      clock.advance(1000)
      room.enter(viewer(id), current)
    }
    room.recordFailure("role-refresh", new Error("helix 503"))
    room.recordFailure("eventsub", new Error("socket closed"))
    room.close(null)
    await room.draw(1, null)

    const snapshot = room.liveSnapshot()

    expect(snapshot.lastNames).toEqual(["Name3", "Name2"])
    expect(snapshot.entriesPerSecond).toBe(0.3)
    expect(snapshot).toMatchObject({
      title: "Giveaway",
      code: "ABCDE",
      status: "drawn",
      entrantCount: 3,
      roleRefreshFailures: 1,
      eventSubFailures: 1,
    })
    expect(snapshot.winners).toHaveLength(1)
    expect(snapshot.winners[0]).toMatchObject({ n: 0, claim: { state: "waiting" } })
    clock.advance(300_001)
    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "expired" })
  })

  it("counts the entries per second in the window before an instant, for the token queue", () => {
    const { room, clock } = setup()
    const start = clock.now()
    for (const id of ["1", "2", "3", "4"]) {
      clock.advance(500)
      room.enter(viewer(id), current)
    }

    // Entered at start + 500, 1000, 1500 and 2000: the window [start + 1000, start + 2000) holds two.
    expect(room.entriesPerSecondBefore(start + 2000, 1)).toBe(2)
    expect(room.entriesPerSecondBefore(start + 2001, 2)).toBe(2)
    expect(room.entriesPerSecondBefore(start, 1)).toBe(0)
  })

  it("shows how a winner claimed and which pick was rerolled", async () => {
    const { room, sql, clock } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close(null)
    await room.draw(1, null)
    await room.reroll(0, null)
    clock.advance(1234)
    room.claim(1, twitch(String(picks(sql)[1]?.platform_user_id)), "chat", null)

    const claims = room.liveSnapshot().winners.map((winner) => winner.claim)

    expect(claims).toEqual([
      { state: "rerolled" },
      { state: "claimed", via: "chat", at: clock.now() },
    ])
  })
})

function pushes(hub: TestHub) {
  return hub.messages.map((message) => JSON.parse(message).entrantsAfter)
}

describe("GiveawayRoom entrants", () => {
  it("numbers entries from 1 in the order they were written and lists them in that order", () => {
    const { room } = setup()
    room.enter(viewer("30", { subTier: 1 }), current)
    room.enter(viewer("10"), current)
    room.enter(viewer("20", { isFollower: true }), current)

    expect(room.entrants({ afterSeq: 0, limit: 10 })).toEqual([
      {
        seq: 1,
        login: "login30",
        displayName: "Name30",
        tickets: 3,
        group: "sub_t1",
        profileImageUrl: null,
      },
      {
        seq: 2,
        login: "login10",
        displayName: "Name10",
        tickets: 1,
        group: "viewer",
        profileImageUrl: null,
      },
      {
        seq: 3,
        login: "login20",
        displayName: "Name20",
        tickets: 2,
        group: "follower",
        profileImageUrl: null,
      },
    ])
  })

  it("lists the profile picture each entrant had at entry, none for an entrant without one", () => {
    const { room } = setup()
    const picture = "https://static-cdn.jtvnw.net/jtv_user_pictures/login1.png"
    room.enter(viewer("1", { profileImageUrl: picture }), current)
    room.enter(viewer("2"), current)

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((row) => row.profileImageUrl)).toEqual([
      picture,
      null,
    ])
  })

  it("carries the winner's profile picture in the live snapshot", async () => {
    const { room } = setup()
    const picture = "https://static-cdn.jtvnw.net/jtv_user_pictures/login1.png"
    room.enter(viewer("1", { profileImageUrl: picture }), current)
    room.close(null)
    await room.draw(1, null)

    expect(room.liveSnapshot().winners.map((winner) => winner.profileImageUrl)).toEqual([picture])
  })

  it("pages by the last sequence number seen", () => {
    const { room } = setup()
    enterMany(room, ["1", "2", "3", "4", "5"])

    const seqs = (afterSeq: number, limit: number) =>
      room.entrants({ afterSeq, limit }).map((row) => row.seq)

    expect(seqs(0, 2)).toEqual([1, 2])
    expect(seqs(2, 2)).toEqual([3, 4])
    expect(seqs(4, 2)).toEqual([5])
    expect(seqs(5, 2)).toEqual([])
    expect(seqs(99, 2)).toEqual([])
    expect(seqs(0, 1)).toEqual([1])
  })

  it("gives a repeat entry and a refused entry no sequence number", () => {
    const { room } = setup({ ...giveaway, rules: { ...rules, followersOnly: true } })

    room.enter(viewer("1", { isFollower: true }), current)
    room.enter(viewer("1", { isFollower: true }), current)
    room.enter(viewer("2"), current)
    room.enter(viewer("3", { isFollower: true }), current)

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((row) => [row.seq, row.login])).toEqual([
      [1, "login1"],
      [2, "login3"],
    ])
  })

  it("names the entry of each winner by its sequence number", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.setWinnerCount(2)
    room.close(null)
    await room.draw(1, null)
    const pickedIds = picks(sql).map((pick) => String(pick.platform_user_id))

    const winners = room.liveSnapshot().winners.map((winner) => winner.entrySeq)

    expect(winners).toEqual(pickedIds.map(Number))
  })
})

describe("GiveawayRoom live push of entrants", () => {
  it("carries no rows in the first push of a room object and the entrants since the last push after that", () => {
    const { room, clock, hub } = setup()

    room.enter(viewer("1"), current)
    clock.advance(1000)
    room.enter(viewer("2"), current)
    room.enter(viewer("3"), current)
    clock.advance(1000)
    room.onAlarm()

    const [first, second, third] = pushes(hub)
    expect(first).toEqual({ fromSeq: 1, rows: [], truncated: false })
    expect(second).toEqual({
      fromSeq: 1,
      rows: [
        {
          seq: 2,
          login: "login2",
          displayName: "Name2",
          tickets: 1,
          group: "viewer",
          profileImageUrl: null,
        },
      ],
      truncated: false,
    })
    expect(third).toMatchObject({ fromSeq: 2, truncated: false })
    expect(third.rows.map((row: { seq: number }) => row.seq)).toEqual([3])
  })

  it("sends the entrants of a held push when the alarm fires, not one per entry", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"), current)
    clock.advance(100)
    room.enter(viewer("2"), current)
    clock.advance(100)
    room.enter(viewer("3"), current)
    clock.advance(800)

    room.onAlarm()

    expect(hub.messages).toHaveLength(2)
    expect(pushes(hub)[1].rows.map((row: { seq: number }) => row.seq)).toEqual([2, 3])
  })

  it("marks a push truncated when more entrants arrived than one push carries and continues after them", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"), current)
    clock.advance(100)
    enterMany(room, ["2", "3", "4"])
    clock.advance(900)
    room.onAlarm()
    clock.advance(1000)
    room.enter(viewer("5"), current)

    const [, truncated, next] = pushes(hub)
    expect(truncated.fromSeq).toBe(1)
    expect(truncated.truncated).toBe(true)
    expect(truncated.rows.map((row: { seq: number }) => row.seq)).toEqual([2, 3])
    expect(next.fromSeq).toBe(4)
    expect(next.truncated).toBe(false)
    expect(next.rows.map((row: { seq: number }) => row.seq)).toEqual([5])
  })

  it("sends exactly the maximum without marking it truncated", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"), current)
    clock.advance(100)
    enterMany(room, ["2", "3"])
    clock.advance(900)
    room.onAlarm()

    expect(pushes(hub)[1]).toMatchObject({ fromSeq: 1, truncated: false })
    expect(pushes(hub)[1].rows).toHaveLength(2)
  })

  it("keeps the same rows for the next push when a push fails", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"), current)
    clock.advance(1000)
    spyOn(console, "warn").mockImplementation(() => {})
    const broadcast = spyOn(hub, "broadcast").mockImplementationOnce(() => {
      throw new Error("socket gone")
    })
    room.enter(viewer("2"), current)
    broadcast.mockRestore()
    clock.advance(1000)

    room.enter(viewer("3"), current)

    expect(
      pushes(hub)
        .at(-1)
        .rows.map((row: { seq: number }) => row.seq),
    ).toEqual([2, 3])
  })

  it("tells when the committed drand round is published, and nothing before the commit", async () => {
    const { room, clock } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    expect(room.liveSnapshot().drawAvailableAt).toBeNull()
    room.close(null)
    expect(room.liveSnapshot().drawAvailableAt).toBeNull()

    await room.commit()

    expect(room.liveSnapshot()).toMatchObject({
      drawAvailableAt: genesisMs + 6000,
      now: genesisMs,
    })
  })

  it("pushes the live snapshot with drawAvailableAt once the commit is stored", async () => {
    const { room, clock, hub } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.close(null)
    clock.advance(config.liveIntervalMs * 3)
    const before = hub.messages.length

    await room.commit()

    const pushed = hub.messages.slice(before).map((message) => JSON.parse(message))
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ status: "closed", drawAvailableAt: genesisMs + 9000 })
  })

  it("keeps the entrants out of the snapshot a GET returns", () => {
    const { room } = setup()
    room.enter(viewer("1"), current)

    expect(room.liveSnapshot()).not.toHaveProperty("entrantsAfter")
  })
})

describe("GiveawayRoom failures", () => {
  it("logs the giveaway id and the cause and never a viewer name", () => {
    const { room } = setup()
    room.enter(viewer("1", { login: "secretlogin", displayName: "SecretName" }), current)
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const cause = new Error("helix 503")

    room.recordFailure("role-refresh", cause)

    const call = warn.mock.calls.find(([message]) => message === "room failure")
    expect(call?.[1]).toEqual({ giveawayId: "g1", kind: "role-refresh", error: cause })
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secretlogin")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SecretName")
    expect(room.liveSnapshot().roleRefreshFailures).toBe(1)
  })
})

describe("GiveawayRoom entryOf", () => {
  it("returns the entry of an entrant and null for anyone else or another platform", () => {
    const { room, clock } = setup()
    clock.advance(1000)
    room.enter(viewer("1", { subTier: 2 }), current)

    expect(room.entryOf(twitch("1"))).toEqual({ group: "sub_t2", tickets: 4, enteredAt: 1000 })
    expect(room.entryOf(twitch("2"))).toBeNull()
    expect(room.entryOf({ platform: "kick", platformUserId: "1" })).toBeNull()
  })
})

describe("room queries", () => {
  it("finds an entry by its primary key", () => {
    const { sql } = setup()
    const details = plan(sql, entryOfSql, ["twitch", "1"])
    expect(details.some((detail) => detail.startsWith("SEARCH entries USING"))).toBe(true)
  })

  it("reads the newest names through the entries index without sorting", () => {
    const { sql } = setup()
    const details = plan(sql, lastNamesSql, [20])
    expect(details.some((detail) => detail.includes("USING INDEX entries_by_entered_at"))).toBe(
      true,
    )
    expect(details.some((detail) => detail.includes("TEMP B-TREE"))).toBe(false)
  })

  it("counts recent entries by searching the entries index", () => {
    const { sql } = setup()
    const details = plan(sql, recentEntriesCountSql, [0])
    expect(
      details.some(
        (detail) =>
          detail.startsWith("SEARCH")
          && detail.includes("INDEX entries_by_entered_at (entered_at>?)"),
      ),
    ).toBe(true)
  })

  it("counts the entries of a window by searching the entries index", () => {
    const { sql } = setup()
    const details = plan(sql, entriesBetweenCountSql, [0, 1])
    expect(
      details.some(
        (detail) =>
          detail.startsWith("SEARCH")
          && detail.includes("INDEX entries_by_entered_at (entered_at>? AND entered_at<?)"),
      ),
    ).toBe(true)
  })

  it("pages the entrants through the sequence index without sorting", () => {
    const { sql } = setup()
    const details = plan(sql, entrantsAfterSql, [0, 10])
    expect(
      details.some(
        (detail) => detail.startsWith("SEARCH") && detail.includes("INDEX entries_by_seq (seq>?)"),
      ),
    ).toBe(true)
    expect(details.some((detail) => detail.includes("TEMP B-TREE"))).toBe(false)
  })

  it("reads the newest sequence number from the sequence index", () => {
    const { sql } = setup()
    const details = plan(sql, headSeqSql, [])
    expect(details.some((detail) => detail.includes("entries_by_seq"))).toBe(true)
    expect(
      details.some((detail) => detail.startsWith("SCAN entries") && !detail.includes("INDEX")),
    ).toBe(false)
  })
})

function lastViewerPush(hub: TestHub): ViewerPush {
  const push: ViewerPush = JSON.parse(hub.viewerMessages.at(-1) ?? "null")
  return push
}

describe("viewer push", () => {
  it("pushes the current outcome on the first alarm of a fresh instance, whatever a page connected earlier holds", () => {
    const { room, hub } = setup()

    room.viewerPush()
    room.onAlarm()

    expect(hub.viewerMessages).toHaveLength(1)
    expect(lastViewerPush(hub)).toMatchObject({ status: "open", winners: [] })
  })

  it("sends nothing to viewers for entries, which change nothing their page shows", () => {
    const { room, hub } = setup()

    enterMany(room, ["1", "2", "3"])

    expect(hub.messages.length).toBeGreaterThan(0)
    expect(hub.viewerMessages).toEqual([])
  })

  it("pushes closed when the streamer closes entries", () => {
    const { room, hub } = setup()

    room.close(null)

    expect(hub.viewerMessages).toHaveLength(1)
    expect(lastViewerPush(hub)).toEqual({
      status: "closed",
      finished: false,
      chatClaimAvailable: true,
      winners: [],
      now: 0,
    })
  })

  it("pushes closed when the end time passes", () => {
    const { room, hub, clock } = setup({ ...giveaway, closesAt: 5000 })

    clock.advance(5000)
    room.onAlarm()

    expect(lastViewerPush(hub)).toMatchObject({ status: "closed" })
  })

  it("pushes the draw with each winner's platform user id and claim deadline, without the draw's seed or any entrant", async () => {
    const { hub, winner, clock } = await drawnRoom()

    const push = lastViewerPush(hub)

    expect(push).toEqual({
      status: "drawn",
      finished: false,
      chatClaimAvailable: true,
      winners: [
        {
          n: 0,
          platformUserId: winner.platformUserId,
          claimUntil: clock.now() + 300_000,
          claim: { state: "waiting" },
        },
      ],
      now: clock.now(),
    })
  })

  it("pushes a claim to viewers, and the push says the giveaway is finished when it was the last one", async () => {
    const { room, hub, winner } = await drawnRoom()

    room.claim(0, winner, "chat", null)

    expect(lastViewerPush(hub)).toMatchObject({
      finished: true,
      winners: [{ n: 0, claim: { state: "claimed", via: "chat" } }],
    })
  })

  it("pushes the replaced pick as rerolled next to the new one, and the giveaway is not finished", async () => {
    const { room, hub } = await drawnRoom()

    await room.reroll(0, null)

    const push = lastViewerPush(hub)
    expect(push.finished).toBe(false)
    expect(push.winners.map((winner) => [winner.n, winner.claim.state])).toEqual([
      [0, "rerolled"],
      [1, "waiting"],
    ])
  })

  it("pushes the expiry of the last claim time on the alarm that finds it over", async () => {
    const { room, hub, clock } = await drawnRoom()
    const before = hub.viewerMessages.length

    clock.advance(300_001)
    room.onAlarm()

    expect(hub.viewerMessages).toHaveLength(before + 1)
    expect(lastViewerPush(hub)).toMatchObject({
      finished: false,
      winners: [{ claim: { state: "expired" } }],
    })
  })

  it("does not push an outcome that is the same as the last one", async () => {
    const { room, hub, clock } = await drawnRoom()
    const before = hub.viewerMessages.length

    clock.advance(1000)
    room.onAlarm()
    room.onAlarm()

    expect(hub.viewerMessages).toHaveLength(before)
  })

  it("pushes again after the room object was recreated, because it does not know what was sent", async () => {
    const { room, sql, alarm, clock, hub } = await drawnRoom()
    const revivedHub = new TestHub()
    const revived = new GiveawayRoom({
      sql,
      alarm,
      live: revivedHub,
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })
    const before = hub.viewerMessages.length

    room.onAlarm()
    revived.onAlarm()

    expect(hub.viewerMessages).toHaveLength(before)
    expect(revivedHub.viewerMessages).toHaveLength(1)
  })

  it("hands a page that connects now the same outcome with the room's clock", async () => {
    const { room, hub, clock } = await drawnRoom()
    clock.advance(42_000)

    const first = room.viewerPush()

    expect(first).toEqual({ ...lastViewerPush(hub), now: clock.now() })
  })

  it("survives a viewer push that throws and still arms the alarm", async () => {
    const { room, hub, alarm } = await drawnRoom()
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const failure = new Error("socket gone")
    spyOn(hub, "broadcastViewers").mockImplementation(() => {
      throw failure
    })

    room.onAlarm()
    await room.reroll(0, null)

    expect(warn).toHaveBeenCalledWith("room effect failed", {
      giveawayId: "g1",
      effect: "viewer-push",
      error: failure,
    })
    expect(alarm.at).not.toBeNull()
  })
})

describe("public summary", () => {
  it("is not finished while open, closed, or while a pick is waiting or could be rerolled", async () => {
    const open = setup()
    const closed = setup()
    closed.room.close(null)
    const waiting = await drawnRoom()

    expect([open.room, closed.room, waiting.room].map((room) => room.summary().finished)).toEqual([
      false,
      false,
      false,
    ])
  })

  it("is not finished after the last claim time ran out while a reroll can still replace the pick", async () => {
    const expired = await drawnRoom()
    expired.clock.advance(300_001)

    expect(expired.room.summary().finished).toBe(false)
  })

  it("is finished and pushed at the end of the last claim time when no undrawn entrant is left to reroll to", async () => {
    const { room, clock, alarm, hub } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    await room.draw(1, null)
    room.markMirrored(room.mirrorState())
    expect(room.summary().finished).toBe(false)

    clock.advance(300_000)
    room.onAlarm()
    expect(lastViewerPush(hub).finished).toBe(false)
    expect(alarm.at).toBe(300_001)
    clock.advance(1)
    room.onAlarm()

    expect(room.summary().finished).toBe(true)
    expect(lastViewerPush(hub).finished).toBe(true)
    // The chat watch of the claimed winner runs to the end of the reroll window.
    expect(alarm.at).toBe(900_001)
    clock.advance(600_000)
    room.onAlarm()
    // Only the deletion of the entrants' data is left.
    expect(alarm.at).toBe(config.entryRetentionSeconds * 1000)
  })

  it("is finished and pushed once the reroll window after the last claim time has passed", async () => {
    const { room, clock, alarm, hub } = await drawnRoom()
    room.markMirrored(room.mirrorState())
    clock.advance(300_001)
    room.onAlarm()
    expect(alarm.at).toBe(900_001)

    clock.advance(599_999)
    room.onAlarm()
    expect(room.summary().finished).toBe(false)
    expect(lastViewerPush(hub).finished).toBe(false)
    clock.advance(1)
    room.onAlarm()

    expect(room.summary().finished).toBe(true)
    expect(lastViewerPush(hub).finished).toBe(true)
    expect(alarm.at).toBe(config.entryRetentionSeconds * 1000)
  })

  it("tells the live snapshot when the reroll window is over and pushes it to the live pages", async () => {
    const { room, clock, hub } = await drawnRoom()
    room.markMirrored(room.mirrorState())
    clock.advance(1000)
    room.onAlarm()
    const open = room.liveSnapshot().rerollOpen
    const pushed = hub.messages.length
    clock.advance(899_001)
    room.onAlarm()

    expect(open).toBe(true)
    expect(room.liveSnapshot().rerollOpen).toBe(false)
    expect(hub.messages.length).toBe(pushed + 1)
    expect(JSON.parse(hub.messages.at(-1) ?? "null")).toMatchObject({ rerollOpen: false })
  })

  it("pushes the end of the reroll window from a new room instance over the same storage", async () => {
    const { room, sql, clock, alarm } = await drawnRoom()
    room.markMirrored(room.mirrorState())
    clock.advance(1000)
    room.onAlarm()
    const hub = new TestHub()
    const evicted = new GiveawayRoom({
      sql,
      alarm,
      live: hub,
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })
    clock.advance(899_001)

    evicted.onAlarm()

    expect(JSON.parse(hub.messages.at(-1) ?? "null")).toMatchObject({ rerollOpen: false })
  })

  it("keeps the reroll window of an unclaimed pick open to the end of a later pick's window after that pick claimed", async () => {
    const { room, sql, clock } = setup()
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)
    await drawPicks(room, 2)
    clock.advance(300_001)
    await room.reroll(1, null)
    const later = twitch(String(picks(sql)[2]?.platform_user_id))
    clock.advance(299_999)
    expect(room.claim(2, later, "chat", null).kind).toBe("claimed")

    clock.advance(399_999)
    expect(room.liveSnapshot().rerollOpen).toBe(true)
    expect(room.summary().finished).toBe(false)
    clock.advance(200_003)
    expect(room.liveSnapshot().rerollOpen).toBe(false)
    expect(room.summary().finished).toBe(true)
    expect(await room.reroll(0, null)).toEqual({ kind: "reroll-window-over" })
  })

  it("keeps the live snapshot closed for rerolls when every entrant was drawn", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    await room.draw(1, null)
    clock.advance(300_001)

    expect(room.liveSnapshot().rerollOpen).toBe(false)
  })

  it("refuses a reroll that started inside the window but finished after it ended", async () => {
    const { room, sql, clock } = await drawnRoom()
    clock.advance(900_000)

    const started = room.reroll(0, null)
    clock.advance(1)

    expect(await started).toEqual({ kind: "reroll-window-over" })
    expect(picks(sql)).toHaveLength(1)
  })

  it("keeps the live snapshot closed for rerolls while entries are open or the draw has no pick to replace", async () => {
    const open = setup()
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat", null)

    expect([open.room, claimed.room].map((room) => room.liveSnapshot().rerollOpen)).toEqual([
      false,
      false,
    ])
  })

  it("tells the live snapshot nobody is left to reroll while the window is still open", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    await room.draw(1, null)
    clock.advance(300_001)

    expect(room.liveSnapshot()).toMatchObject({ rerollOpen: false, rerollBlocked: "nobody-left" })
  })

  it("tells the live snapshot the window is over", async () => {
    const { room, clock } = await drawnRoom()
    clock.advance(900_001)

    expect(room.liveSnapshot()).toMatchObject({ rerollOpen: false, rerollBlocked: "window-over" })
  })

  it("names the window as the reason when it is over and nobody is left", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    await room.draw(1, null)
    clock.advance(900_001)

    expect(room.liveSnapshot()).toMatchObject({ rerollOpen: false, rerollBlocked: "window-over" })
  })

  it("gives no reroll reason before the draw or once every pick is claimed", async () => {
    const open = setup()
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat", null)

    expect(
      [open.room, claimed.room].map((room) => {
        const { rerollOpen, rerollBlocked } = room.liveSnapshot()
        return { rerollOpen, rerollBlocked }
      }),
    ).toEqual([
      { rerollOpen: false, rerollBlocked: null },
      { rerollOpen: false, rerollBlocked: null },
    ])
  })

  it("gives no reroll reason while the reroll is open", async () => {
    const { room } = await drawnRoom()

    expect(room.liveSnapshot()).toMatchObject({ rerollOpen: true, rerollBlocked: null })
  })

  it("rerolls up to the end of the reroll window and refuses after it", async () => {
    const early = await drawnRoom()
    early.clock.advance(900_000)
    const late = await drawnRoom()
    late.clock.advance(900_001)

    expect(await early.room.reroll(0, null)).toMatchObject({ kind: "rerolled", replaced: 0 })
    expect(await late.room.reroll(0, null)).toEqual({ kind: "reroll-window-over" })
    expect(picks(late.sql)).toHaveLength(1)
  })

  it("is finished once every pick is claimed, and for a draw nobody won", async () => {
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat", null)
    const empty = setup()
    empty.room.close(null)
    await empty.room.draw(1, null)

    expect(claimed.room.summary().finished).toBe(true)
    expect(empty.room.summary().finished).toBe(true)
  })

  it("is not finished after a reroll replaced an expired pick with a waiting one", async () => {
    const rerolled = await drawnRoom()
    rerolled.clock.advance(300_001)

    await rerolled.room.reroll(0, null)

    expect(rerolled.room.summary().finished).toBe(false)
    expect(lastViewerPush(rerolled.hub).finished).toBe(false)
  })

  it("finds the last claim time of the picks a reroll could replace through the index of standing picks", async () => {
    const { sql } = await drawnRoom()

    const details = plan(sql, lastClaimDeadlineSql, [])

    expect(details.some((detail) => detail.includes("INDEX draws_standing"))).toBe(true)
  })

  it("finds the end of the reroll window through the index of standing picks", async () => {
    const { sql } = await drawnRoom()

    const details = plan(sql, lastStandingDeadlineSql, [])

    expect(details.some((detail) => detail.includes("INDEX draws_standing"))).toBe(true)
  })

  it("looks for an undrawn entrant through the unique index of picks", async () => {
    const { sql } = await drawnRoom()

    const details = plan(sql, undrawnEntrantSql, [])

    expect(details.some((detail) => detail.includes("INDEX draws_by_entrant"))).toBe(true)
  })
})

function count(sql: SyncSql, table: "entries" | "channel_roles" | "excluded_users"): unknown {
  return sql.exec(`SELECT COUNT(*) AS c FROM ${table}`, [])[0]?.c
}

// Roles refreshed, so only the counters can wake the room within the first minutes.
function quietRoom(env: Record<string, string> = {}) {
  const context = setup(giveaway, random, env)
  context.room.replaceRoles([], [])
  return context
}

describe("GiveawayRoom minute counts", () => {
  const minute = 60_000

  it("wakes the room at the end of the minute of the first entry nobody reported", () => {
    const { room, clock, alarm } = quietRoom()
    clock.advance(10_000)

    room.enter(viewer("1"), current)

    expect(alarm.at).toBe(minute)
  })

  it("reports each finished minute once, with its entries, and not the minute in progress", () => {
    const { room, clock } = quietRoom()
    clock.advance(10_000)
    room.enter(viewer("1"), current)
    clock.advance(10_000)
    room.enter(viewer("2"), current)
    clock.advance(50_000)
    room.enter(viewer("3"), current)
    clock.advance(10_000)

    expect(room.onAlarm().metrics).toEqual([{ minute: 0, entries: 2, claims: 0 }])

    clock.advance(minute)
    expect(room.onAlarm().metrics).toEqual([{ minute, entries: 1, claims: 0 }])
    expect(room.onAlarm().metrics).toEqual([])
  })

  it("reports nothing and keeps the alarm at the end of the minute while that minute is in progress", () => {
    const { room, clock, alarm } = quietRoom()
    clock.advance(10_000)
    room.enter(viewer("1"), current)
    clock.advance(10_000)

    expect(room.onAlarm().metrics).toEqual([])
    expect(alarm.at).toBe(minute)
  })

  it("does not wake the room again once every minute is reported", () => {
    const { room, clock, alarm } = quietRoom()
    room.enter(viewer("1"), current)
    clock.advance(minute)
    room.onAlarm()

    expect(alarm.at).not.toBe(minute)
  })

  it("reports the minutes of a room object that was evicted before the alarm", () => {
    const { room, sql, clock, alarm } = quietRoom()
    room.enter(viewer("1"), current)
    clock.advance(minute)
    const revived = new GiveawayRoom({
      sql,
      alarm,
      live: new TestHub(),
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })

    expect(revived.onAlarm().metrics).toEqual([{ minute: 0, entries: 1, claims: 0 }])
  })

  it("reports the claims of a minute together with its entries", async () => {
    const { room, clock, winner } = await drawnRoom()
    expect(room.claim(0, winner, "manual", null).kind).toBe("claimed")
    clock.advance(minute)

    const metrics = room.onAlarm().metrics

    expect(metrics.reduce((total, row) => total + row.entries, 0)).toBe(3)
    expect(metrics.reduce((total, row) => total + row.claims, 0)).toBe(1)
  })

  it("leaves out minutes older than the retention and does not wake the room for them", () => {
    const { room, clock, alarm } = quietRoom({ METRICS_RETENTION_HOURS: "1" })
    room.enter(viewer("1"), current)
    clock.advance(3 * 3_600_000)

    expect(room.onAlarm().metrics).toEqual([])
    expect(alarm.at).not.toBe(minute)
  })

  it("counts the entries and claims of the last minute for the admin page", () => {
    const { room, clock } = quietRoom()
    room.enter(viewer("1"), current)
    clock.advance(30_000)
    room.enter(viewer("2"), current)
    clock.advance(40_000)
    room.enter(viewer("3"), current)

    expect(room.liveCounts()).toEqual({ entrants: 3, entriesLastMinute: 2, claimsLastMinute: 0 })
  })
})

describe("GiveawayRoom retention", () => {
  const retentionMs = config.entryRetentionSeconds * 1000

  it("deletes entries, channel roles and excluded accounts once the retention time after the close has passed, and nothing before", async () => {
    const { room, sql, clock } = await drawnRoom()
    room.replaceRoles(["9"], [])
    room.loadExclusions({ blocked: blockList(0, ["7"]), recentWinners: ["8"] })

    clock.advance(retentionMs - 1)
    room.onAlarm()
    expect([
      count(sql, "entries"),
      count(sql, "channel_roles"),
      count(sql, "excluded_users"),
    ]).toEqual([3, 1, 2])

    clock.advance(1)
    room.onAlarm()
    expect([
      count(sql, "entries"),
      count(sql, "channel_roles"),
      count(sql, "excluded_users"),
    ]).toEqual([0, 0, 0])
  })

  it("still deletes the excluded accounts of a room nobody entered", () => {
    const { room, sql, clock } = setup()
    room.loadExclusions({ blocked: blockList(0, ["7"]), recentWinners: [] })
    room.close(null)

    clock.advance(retentionMs)
    room.onAlarm()

    expect(count(sql, "excluded_users")).toBe(0)
  })

  it("keeps the counts, the status and the picks, and the winner keeps the name but loses the entry and the picture", async () => {
    const { room, clock, winner } = await drawnRoom()

    clock.advance(retentionMs)
    room.onAlarm()

    expect(room.summary()).toMatchObject({ status: "drawn", entrantCount: 3, ticketTotal: 3 })
    expect(room.picks()).toMatchObject([
      {
        n: 0,
        platformUserId: winner.platformUserId,
        entrySeq: null,
        login: `login${winner.platformUserId}`,
        displayName: `Name${winner.platformUserId}`,
        profileImageUrl: null,
      },
    ])
    expect(room.liveSnapshot().winners).toMatchObject([
      { displayName: `Name${winner.platformUserId}` },
    ])
    expect(room.entryOf(winner)).toBeNull()
    expect(room.liveSnapshot().lastNames).toEqual([])
  })

  it("replaces one winner's name and picture with removed on request, in the pick and in the entry", async () => {
    const { room, winner } = await drawnRoom()

    expect(room.removeWinnerName(0)).toEqual({ kind: "removed" })

    expect(room.picks()).toMatchObject([
      { n: 0, login: "removed", displayName: "removed", profileImageUrl: null },
    ])
    expect(
      room.entrants({ afterSeq: 0, limit: 10 }).filter((row) => row.login === "removed"),
    ).toHaveLength(1)
    expect(room.entryOf(winner)).not.toBeNull()
    expect(room.removeWinnerName(5)).toEqual({ kind: "unknown-pick" })
  })

  it("keeps no name of an entrant who did not win", async () => {
    const { room, sql, clock, winner } = await drawnRoom()

    clock.advance(retentionMs)
    room.onAlarm()

    const names = sql.exec("SELECT login, display_name FROM draws", [])
    expect(names).toEqual([
      {
        login: `login${winner.platformUserId}`,
        display_name: `Name${winner.platformUserId}`,
      },
    ])
    expect(count(sql, "entries")).toBe(0)
  })

  it("keeps the name of a rerolled winner with the pick", async () => {
    const { room, clock } = await drawnRoom()
    await room.reroll(0, null)

    clock.advance(retentionMs)
    room.onAlarm()

    expect(room.picks().map((pick) => pick.displayName)).toEqual(
      room.picks().map((pick) => `Name${pick.platformUserId}`),
    )
    expect(room.picks()).toHaveLength(2)
  })

  it("counts the retention time from the close, not from the entry", () => {
    const { room, sql, clock } = setup()
    room.enter(viewer("1"), current)
    clock.advance(retentionMs)
    room.onAlarm()
    expect(count(sql, "entries")).toBe(1)

    room.close(null)
    clock.advance(retentionMs - 1)
    room.onAlarm()
    expect(count(sql, "entries")).toBe(1)

    clock.advance(1)
    room.onAlarm()
    expect(count(sql, "entries")).toBe(0)
  })

  it("sets the alarm to the deadline while data remains and to nothing once it is deleted", async () => {
    const { room, alarm, clock } = setup()
    room.enter(viewer("1"), current)
    clock.advance(60_000)
    room.onAlarm()
    clock.advance(1000)
    room.close(null)
    clock.advance(config.liveIntervalMs)
    await room.commit()
    room.markMirrored(room.mirrorState())
    expect(alarm.at).toBe(61_000 + retentionMs)

    clock.advance(retentionMs)
    room.onAlarm()

    expect(alarm.at).toBeNull()
  })

  it("arms the retention alarm of a room that was closed before the schema change and gets no further write", async () => {
    const sql = new BunSqliteSyncSql(new Database(":memory:"))
    applyMigrations(sql, roomMigrations.slice(0, 1))
    sql.exec(
      `INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, closes_at)
       VALUES (1, 'twitch', 'g1', 'b', 't', 'ABCDE', ?, 300, 'closed', 1000)`,
      [JSON.stringify(rules)],
    )
    sql.exec(
      "INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at) VALUES (1, 'twitch', 'u', 'l', 'n', 'viewer', 1, 500)",
      [],
    )
    applyMigrations(sql, roomMigrations)
    // The entry's minute is reported already, so only the retention wakes the room.
    sql.exec("UPDATE room_state SET metrics_reported_until = 60000 WHERE id = 1", [])
    const clock = new TestClock(0)
    const alarm = new TestAlarm()
    const room = new GiveawayRoom({
      sql,
      alarm,
      live: new TestHub(),
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })

    await room.commit()
    room.armAlarm()
    expect(alarm.at).toBe(1000 + retentionMs)

    clock.advance(1000 + retentionMs)
    room.onAlarm()
    expect(count(sql, "entries")).toBe(0)
  })

  it("arms nothing for a room that was never initialised", () => {
    const sql = new BunSqliteSyncSql(new Database(":memory:"))
    applyMigrations(sql, roomMigrations)
    const alarm = new TestAlarm()
    const clock = new TestClock(0)
    const room = new GiveawayRoom({
      sql,
      alarm,
      live: new TestHub(),
      clock,
      random,
      config,
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })

    room.armAlarm()

    expect(alarm.at).toBeNull()
  })

  it("refuses to draw a closed room whose entries were deleted, and leaves it closed", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    clock.advance(retentionMs)
    room.onAlarm()

    expect(await room.draw(1, null)).toEqual({ kind: "entries-deleted" })
    expect(room.summary()).toMatchObject({ status: "closed" })
    expect(room.picks()).toEqual([])
  })

  it("draws a closed room that never had entries after the retention time", async () => {
    const { room, clock } = setup()
    room.close(null)
    clock.advance(retentionMs)
    room.onAlarm()

    expect(await room.draw(1, null)).toEqual({ kind: "no-entrants-left" })
    expect(room.summary().status).toBe("drawn")
  })

  it("refuses to reroll once the entries were deleted", async () => {
    const { room, clock } = await drawnRoom()
    clock.advance(retentionMs)
    room.onAlarm()

    expect(await room.reroll(0, null)).toEqual({ kind: "entries-deleted" })
    expect(room.picks()).toHaveLength(1)
  })

  it("keeps the root, the round and the leaves after the entries are deleted, and does not commit then", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    await room.commit()
    const before = { commitment: room.verification().commitment, leaves: room.leaves() }

    clock.advance(retentionMs)
    room.onAlarm()
    await room.commit()

    expect(room.leafOf(twitch("1"))).toBeNull()
    expect(room.verification().commitment).toEqual(before.commitment)
    expect(room.leaves()).toEqual(before.leaves)
    expect(before.leaves).toHaveLength(1)
  })

  it("does not commit a closed room whose entries were deleted before it committed", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"), current)
    room.close(null)
    clock.advance(retentionMs)
    room.onAlarm()

    await room.commit()

    expect(room.verification().commitment).toBeNull()
    expect(room.onAlarm().commit).toBe(false)
    expect(await room.draw(1, null)).toEqual({ kind: "entries-deleted" })
  })

  it("never deletes the entries of an open room", () => {
    const { room, sql, clock } = setup()
    room.enter(viewer("1"), current)

    clock.advance(10 * retentionMs)
    room.onAlarm()

    expect(count(sql, "entries")).toBe(1)
  })

  it("refuses to read a closed room that has no close time", () => {
    const { room, sql } = setup()
    room.close(null)
    sql.exec("UPDATE room_state SET closed_at = NULL", [])

    expect(() => room.summary()).toThrow(RoomRowError)
  })
})

// A salt per call that differs from every other, so leaves can be told apart.
function countingRandom(): Random {
  let next = 0
  return {
    bytes: (length) => {
      next += 1
      return new Uint8Array(length).fill(next % 256)
    },
  }
}

const genesisMs = quicknet.genesisSeconds * 1000

describe("GiveawayRoom salt", () => {
  it("gives each entry 16 random bytes", () => {
    const { room, sql } = setup(giveaway, countingRandom())
    enterMany(room, ["1", "2"])

    const salts = sql.exec("SELECT salt FROM entries ORDER BY seq", []).map((row) => row.salt)

    expect(salts).toEqual([new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)])
  })

  it("shows the salt to nobody but its entry through leafOf", () => {
    const { room } = setup(giveaway, countingRandom())
    enterMany(room, ["1", "2"])

    expect(room.leafOf(twitch("2"))).toEqual({
      ...twitch("2"),
      tickets: 1,
      salt: new Uint8Array(16).fill(2),
    })
    expect(room.leafOf(twitch("3"))).toBeNull()
  })

  it("keeps the salt out of every push to a page", () => {
    const { room, hub } = setup(giveaway, countingRandom())
    enterMany(room, ["1"])
    room.close(null)

    const texts = [...hub.messages, ...hub.overlayMessages, ...hub.viewerMessages].join()

    expect(texts).not.toContain("salt")
    expect(JSON.stringify(room.summary())).not.toContain("salt")
    expect(JSON.stringify(room.liveSnapshot())).not.toContain("salt")
  })
})

function saltOf(sql: SyncSql, id: string): Uint8Array<ArrayBuffer> {
  const salt = sql.exec("SELECT salt FROM entries WHERE platform_user_id = ?", [id])[0]?.salt
  if (!(salt instanceof Uint8Array)) throw new Error("entry has no salt")
  return new Uint8Array(salt)
}

describe("GiveawayRoom commit", () => {
  it("stores the Merkle root over the leaves sorted by platform user id, and the leaves", async () => {
    const { room, sql, clock } = setup(giveaway, countingRandom())
    clock.advance(genesisMs)
    enterMany(room, ["30", "10", "20"])
    room.close(null)

    await room.commit()

    const expected = await Promise.all(
      ["10", "20", "30"].map((id) =>
        leafHash({ ...twitch(id), tickets: 1, salt: saltOf(sql, id) }),
      ),
    )
    const leaves = room.leaves()
    expect(leaves?.map((leaf) => toHex(leaf.hash))).toEqual(expected.map(toHex))
    expect(leaves?.map((leaf) => leaf.tickets)).toEqual([1, 1, 1])
    expect(room.verification().commitment?.merkleRoot).toEqual(
      await merkleRoot(expected.map((hash) => ({ hash, tickets: 1 }))),
    )
  })

  it("commits to the first round at least the lead after the close, and to nothing before the close", async () => {
    const { room, clock } = setup()
    clock.advance(genesisMs)
    await room.commit()
    expect(room.verification().commitment).toBeNull()
    expect(room.leaves()).toBeNull()

    room.close(null)
    await room.commit()

    // 6 s after genesis is the time of round 3.
    expect(room.verification().commitment?.drandRound).toBe(3)
    expect(roundTime(quicknet, 3)).toBe(genesisMs + 6000)
  })

  it("commits an empty room to the root of nothing", async () => {
    const { room } = setup()
    room.close(null)

    await room.commit()

    expect(room.leaves()).toEqual([])
    expect(room.verification().commitment?.merkleRoot).toEqual(await merkleRoot([]))
  })

  it("writes the leaves in chunks that read back whole and in order", async () => {
    const { room, sql } = setup()
    const ids = Array.from({ length: 1001 }, (_, i) => String(i).padStart(5, "0"))
    enterMany(room, ids)
    room.close(null)

    await room.commit()

    expect(sql.exec("SELECT COUNT(*) AS c FROM leaves", [])[0]?.c).toBe(2)
    expect(room.leaves()).toHaveLength(1001)
    expect(room.verification().entrantCount).toBe(1001)
  })

  it("commits once when two commits run at the same time", async () => {
    const { room, sql } = setup(giveaway, countingRandom())
    enterMany(room, ["1", "2"])
    room.close(null)

    await Promise.all([room.commit(), room.commit()])

    expect(sql.exec("SELECT COUNT(*) AS c FROM leaves", [])[0]?.c).toBe(1)
    expect(room.leaves()).toHaveLength(2)
  })

  it("leaves an open room and a committed room alone", async () => {
    const { room, clock } = setup()
    enterMany(room, ["1"])
    await room.commit()
    expect(room.verification().commitment).toBeNull()

    room.close(null)
    await room.commit()
    const first = room.verification().commitment
    clock.advance(60_000)
    await room.commit()

    expect(room.verification().commitment).toEqual(first)
  })

  it("is due from the alarm right after the close and again after the retry delay while it fails", async () => {
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    expect(alarm.at).toBe(0)

    expect(room.onAlarm().commit).toBe(true)
    expect(alarm.at).toBe(30_000)
    clock.advance(29_999)
    expect(room.onAlarm().commit).toBe(false)
    clock.advance(1)
    expect(room.onAlarm().commit).toBe(true)

    await room.commit()
    clock.advance(60_000)
    expect(room.onAlarm().commit).toBe(false)
  })

  it("doubles the wait before each retry of a commit that keeps failing", () => {
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    room.markMirrored(room.mirrorState())

    const waits: number[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(room.onAlarm().commit).toBe(true)
      waits.push((alarm.at ?? clock.now()) - clock.now())
      advanceToAlarm(clock, alarm)
    }

    expect(waits).toEqual([30_000, 60_000, 120_000])
  })

  it("gives up after the maximum of attempts, logs it once and arms no alarm for the commit", () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    room.markMirrored(room.mirrorState())
    for (let attempt = 0; attempt < config.commitMaxAttempts; attempt++) {
      expect(room.onAlarm().commit).toBe(true)
      advanceToAlarm(clock, alarm)
    }

    expect(error).not.toHaveBeenCalled()
    expect(room.onAlarm().commit).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith("room commit gave up", {
      giveawayId: expect.any(String),
      attempts: config.commitMaxAttempts,
    })
    expect(alarm.at).toBeNull()
    clock.advance(24 * 3600 * 1000)
    expect(room.onAlarm().commit).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it("keeps counting attempts and the wait across a new room instance over the same storage", () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { room, sql, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    room.markMirrored(room.mirrorState())
    const revive = () =>
      new GiveawayRoom({
        sql,
        alarm,
        live: new TestHub(),
        clock,
        random,
        config,
        chat: idleChat(clock, config),
        beacon: new FakeBeacon(),
      })

    expect(room.onAlarm().commit).toBe(true)
    clock.advance(1000)
    expect(revive().onAlarm().commit).toBe(false)
    advanceToAlarm(clock, alarm)
    for (let attempt = 1; attempt < config.commitMaxAttempts; attempt++) {
      expect(revive().onAlarm().commit).toBe(true)
      advanceToAlarm(clock, alarm)
    }
    expect(revive().onAlarm().commit).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(alarm.at).toBeNull()
    clock.advance(24 * 3600 * 1000)
    expect(revive().onAlarm().commit).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it("still commits when a draw asks after the alarm gave up", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close(null)
    room.markMirrored(room.mirrorState())
    for (let attempt = 0; attempt <= config.commitMaxAttempts; attempt++) {
      room.onAlarm()
      advanceToAlarm(clock, alarm)
    }
    expect(room.verification().commitment).toBeNull()

    await room.draw(1, null)

    expect(room.verification().commitment).not.toBeNull()
  })

  it("is due when the end time closes the room", () => {
    const { room, clock } = setup({ ...giveaway, closesAt: 5000 })
    room.replaceRoles([], [])
    clock.advance(5000)

    expect(room.onAlarm().commit).toBe(true)
  })
})

// The database of the code before commitments existed, with entries written by raw SQL, then upgraded in place.
function legacyRoom(ids: readonly string[], status: "open" | "closed", rng: Random) {
  const sql = new BunSqliteSyncSql(new Database(":memory:"))
  applyMigrations(sql, roomMigrations.slice(0, 1))
  sql.exec(
    "INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, entrant_count, ticket_total) VALUES (1, 'twitch', 'g1', 'broadcaster', 'Giveaway', 'ABCDE', ?, 300, ?, ?, ?)",
    [JSON.stringify(rules), status, ids.length, ids.length],
  )
  for (const [index, id] of ids.entries()) {
    sql.exec(
      "INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at) VALUES (?, 'twitch', ?, ?, ?, 'viewer', 1, 0)",
      [index + 1, id, `login${id}`, `Name${id}`],
    )
  }
  return {
    sql,
    upgrade() {
      applyMigrations(sql, roomMigrations)
      const clock = new TestClock(0)
      return new GiveawayRoom({
        sql,
        alarm: new TestAlarm(),
        live: new TestHub(),
        clock,
        random: rng,
        config,
        chat: idleChat(clock, config),
        beacon: new FakeBeacon(),
      })
    },
  }
}

describe("GiveawayRoom of an older database", () => {
  it("salts an entry written before salts existed at commit, and keeps the salt it got", async () => {
    const { sql, upgrade } = legacyRoom(["1"], "closed", countingRandom())
    const room = upgrade()
    expect(room.leafOf(twitch("1"))?.salt).toBeNull()

    await room.commit()

    const salt = saltOf(sql, "1")
    expect(room.leafOf(twitch("1"))?.salt).toEqual(salt)
    expect(room.leaves()?.map((leaf) => toHex(leaf.hash))).toEqual([
      toHex(await leafHash({ ...twitch("1"), tickets: 1, salt })),
    ])
  })

  it("lets an entry of the older code enter a room that is still open, and commit later", async () => {
    const { upgrade } = legacyRoom(["1"], "open", countingRandom())
    const room = upgrade()
    room.loadExclusions(noExclusions)

    expect(room.enter(viewer("2"), current).kind).toBe("entered")
    room.close(null)
    await room.commit()

    expect(room.leaves()).toHaveLength(2)
  })

  it("reports a room drawn before commitments existed as having none, and still rerolls it", async () => {
    const { sql, upgrade } = legacyRoom(["1", "2", "3"], "closed", random)
    sql.exec("UPDATE room_state SET status = 'drawn', seed = ?", [new Uint8Array(32).fill(9)])
    sql.exec(
      "INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until) VALUES (0, 'twitch', '1', 0, 300000)",
      [],
    )
    const room = upgrade()

    await room.commit()
    const outcome = await room.reroll(0, null)

    expect(room.verification()).toMatchObject({
      status: "drawn",
      commitment: null,
      picks: [{ n: 0, leafIndex: null, rerolled: true }, { n: 1 }],
    })
    expect(room.leaves()).toBeNull()
    expect(room.onAlarm().commit).toBe(false)
    expect(outcome.kind).toBe("rerolled")
  })
})

describe("GiveawayRoom damaged commitment", () => {
  it("refuses a leaf chunk that is not whole records and one that holds an impossible ticket count", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1"])
    room.close(null)
    await room.commit()

    sql.exec("UPDATE leaves SET data = ?", [new Uint8Array(39)])
    expect(() => room.leaves()).toThrow(RoomRowError)

    sql.exec("UPDATE leaves SET data = ?", [new Uint8Array(40).fill(255)])
    expect(() => room.leaves()).toThrow(RoomRowError)
  })

  it("refuses a root without a round and a round without a root", () => {
    const { room, sql } = setup()
    room.close(null)

    sql.exec("UPDATE room_state SET merkle_root = ?", [new Uint8Array(32)])
    expect(() => room.verification()).toThrow(RoomRowError)

    sql.exec("UPDATE room_state SET merkle_root = NULL, drand_round = 5", [])
    expect(() => room.verification()).toThrow(RoomRowError)
  })
})

describe("GiveawayRoom draw with drand", () => {
  it("commits at the draw when the alarm has not yet, and seeds the draw with the round it committed to", async () => {
    const { room, sql, beacon } = setup(giveaway, countingRandom())
    enterMany(room, ["1", "2", "3"])
    room.setWinnerCount(2)
    room.close(null)

    const outcome = await room.draw(1, null)

    const round = room.verification().commitment?.drandRound
    expect(round).toBeGreaterThan(0)
    expect(beacon.requested).toEqual([round ?? -1])
    expect(sql.exec("SELECT seed FROM room_state", [])[0]?.seed).toEqual(fakeRandomness)
    expect(outcome.kind).toBe("drawn")
  })

  it("draws nothing while the round is not published and says when it comes", async () => {
    const { room, sql, beacon, clock } = setup()
    clock.advance(genesisMs)
    enterMany(room, ["1"])
    room.close(null)
    beacon.answer = "not-yet"

    const outcome = await room.draw(1, null)

    expect(outcome).toEqual({
      kind: "round-pending",
      availableAt: genesisMs + 6000,
      now: genesisMs,
    })
    expect(room.summary().status).toBe("closed")
    expect(sql.exec("SELECT seed FROM room_state", [])[0]?.seed).toBeNull()
    expect(picks(sql)).toEqual([])
  })

  it("draws nothing while the beacon fails and draws on a repeat", async () => {
    const { room, sql, beacon } = setup()
    enterMany(room, ["1"])
    room.close(null)
    beacon.answer = "unavailable"

    expect(await room.draw(1, null)).toEqual({ kind: "beacon-unavailable" })
    expect(room.summary().status).toBe("closed")
    expect(picks(sql)).toEqual([])

    beacon.answer = "round"
    expect((await room.draw(1, null)).kind).toBe("drawn")
  })

  it("asks for random bytes only for salts, never for a seed", async () => {
    const lengths: number[] = []
    const { room } = setup(giveaway, {
      bytes: (length) => {
        lengths.push(length)
        return new Uint8Array(length)
      },
    })
    enterMany(room, ["1", "2"])
    room.close(null)
    await room.draw(1, null)

    expect(lengths).toEqual([16, 16])
  })

  it("stores the leaf index of every pick, rerolls included, and they replay from the leaves", async () => {
    const { room, sql } = setup(giveaway, countingRandom())
    enterMany(room, ["1", "2", "3", "4"])
    room.close(null)
    await drawPicks(room, 2)
    await room.reroll(0, null)

    const leaves = room.leaves() ?? []
    const replay = await drawLeafPicks(
      fakeRandomness,
      leaves.map((leaf) => leaf.tickets),
      3,
      fromFirstPick,
    )

    expect(room.verification().picks).toEqual(
      replay.map((pick) => ({ n: pick.n, leafIndex: pick.leafIndex, rerolled: pick.n === 0 })),
    )
    const ids = sql.exec("SELECT platform_user_id FROM draws ORDER BY n", [])
    expect(ids.map((row) => row.platform_user_id)).toEqual(
      replay.map((pick) => String(pick.leafIndex + 1)),
    )
  })
})

describe("GiveawayRoom shuffle names", () => {
  const ids = ["1", "2", "3", "4", "5"]
  const entrantNames = ids.map((id) => `Name${id}`)

  it("sends none while entries are open", () => {
    const { room } = setup()
    enterMany(room, ids)

    expect(room.liveSnapshot().shuffleNames).toEqual([])
  })

  it("sends a bounded sample of entrant names once the room is committed", async () => {
    const { room } = setup(giveaway, random, { LIVE_SHUFFLE_NAMES: "3" })
    enterMany(room, ids)
    room.close(null)
    expect(room.liveSnapshot().shuffleNames).toEqual([])
    await room.commit()

    const sample = room.liveSnapshot().shuffleNames

    expect(sample).toHaveLength(3)
    expect(new Set(sample).size).toBe(3)
    expect(sample.every((name) => entrantNames.includes(name))).toBe(true)
  })

  it("keeps sending the sample after the draw, so a next draw or reroll can shuffle", async () => {
    const { room } = setup(giveaway, random, { LIVE_SHUFFLE_NAMES: "3" })
    enterMany(room, ids)
    room.close(null)
    await room.commit()
    await room.draw(1, null)

    const sample = room.liveSnapshot().shuffleNames

    expect(sample).toHaveLength(3)
    expect(sample.every((name) => entrantNames.includes(name))).toBe(true)
  })

  it("sends the sample as soon as the draw is requested", () => {
    const { room } = setup()
    enterMany(room, ids)

    room.requestDraw(1, null)

    expect(room.liveSnapshot().shuffleNames.length).toBeGreaterThan(0)
  })
})

describe("GiveawayRoom winner count", () => {
  it("is the planned count the giveaway was created with", () => {
    const { room } = setup({ ...giveaway, winnerCount: 2 })

    expect(room.summary().winnerCount).toBe(2)
    expect(room.verification().winnerCount).toBe(2)
  })

  it("changes while entries are open, and a push tells the live page", () => {
    const { room, hub } = setup()
    const before = hub.messages.length

    expect(room.setWinnerCount(4)).toEqual({ kind: "set" })

    expect(room.summary().winnerCount).toBe(4)
    expect(hub.messages.length).toBeGreaterThan(before)
    expect(hub.messages.at(-1)).toContain('"winnerCount":4')
  })

  it("changes after the draw too, without touching the picks", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2"])
    room.close(null)
    await room.draw(1, null)

    expect(room.setWinnerCount(3)).toEqual({ kind: "set" })

    expect(room.summary().winnerCount).toBe(3)
    expect(picks(sql)).toHaveLength(1)
  })

  it("is 1 for a room that existed before the migration", () => {
    const { upgrade } = legacyRoom(["1"], "closed", random)

    expect(upgrade().summary().winnerCount).toBe(1)
  })
})

describe("GiveawayRoom commitment record", () => {
  it("keeps the time of the commit and the chain it committed to", async () => {
    const { room, clock } = setup()
    clock.advance(1234)
    room.close(null)
    await room.commit()

    expect(room.verification().commitment).toMatchObject({
      committedAt: 1234,
      chain: {
        chainHash: quicknet.chainHash,
        genesisSeconds: quicknet.genesisSeconds,
        periodSeconds: quicknet.periodSeconds,
      },
    })
  })

  it("asks the beacon for the chain it committed to", async () => {
    const { room, beacon } = setup()
    room.close(null)

    await room.draw(1, null)

    expect(beacon.requestedChains).toEqual([quicknet.chainHash])
  })
})

describe("GiveawayRoom late round", () => {
  it("answers pending while the round is within the margin after its time, and unavailable after", async () => {
    const { room, beacon, clock } = setup()
    clock.advance(genesisMs)
    room.close(null)
    await room.commit()
    beacon.answer = "not-yet"
    clock.advance(6000 + config.drandPublishMarginSeconds * 1000)

    expect((await room.draw(1, null)).kind).toBe("round-pending")
    clock.advance(1)
    expect(await room.draw(1, null)).toEqual({ kind: "beacon-unavailable" })
  })
})

describe("GiveawayRoom reroll timing", () => {
  it("lets the streamer reroll a pick that is still inside its claim time", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2"])
    room.close(null)
    await room.draw(1, null)

    const outcome = await room.reroll(0, null)

    expect(outcome.kind).toBe("rerolled")
    expect(picks(sql).map((row) => row.rerolled)).toEqual([1, 0])
  })
})

describe("GiveawayRoom populated before the minute counters", () => {
  const hour = 3_600_000

  // The room as 0001 to 0006 left it: an open giveaway with an entry long ago and one a minute and a half ago.
  function oldRoom(clockAt: number, env: Record<string, string> = {}) {
    const sql = new BunSqliteSyncSql(new Database(":memory:"))
    applyMigrations(sql, roomMigrations.slice(0, 6))
    sql.exec(
      `INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, roles_refresh_at)
       VALUES (1, 'twitch', 'g1', 'b', 't', 'ABCDE', ?, 300, 'open', ?)`,
      [JSON.stringify(rules), clockAt + hour],
    )
    for (const [seq, at] of [
      [1, 500],
      [2, clockAt - 90_000],
    ] as const) {
      sql.exec(
        "INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at) VALUES (?, 'twitch', ?, 'l', 'n', 'viewer', 1, ?)",
        [seq, `u${seq}`, at],
      )
    }
    applyMigrations(sql, roomMigrations)
    const clock = new TestClock(clockAt)
    const alarm = new TestAlarm()
    const room = new GiveawayRoom({
      sql,
      alarm,
      live: new TestHub(),
      clock,
      random,
      config: resolveConfig({ ...baseEnv, ...env }),
      chat: idleChat(clock, config),
      beacon: new FakeBeacon(),
    })
    return { sql, room, clock, alarm }
  }

  it("keeps its rows and starts with nothing reported", () => {
    const { sql, room } = oldRoom(30 * hour)

    expect(count(sql, "entries")).toBe(2)
    expect(sql.exec("SELECT metrics_reported_until AS m FROM room_state", [])[0]?.m).toBe(0)
    expect(room.summary().status).toBe("open")
  })

  it("reports on its first alarm only the minutes within the retention, not its whole history", () => {
    const clockAt = 30 * hour
    const { room } = oldRoom(clockAt, { METRICS_RETENTION_HOURS: "24" })

    const { metrics } = room.onAlarm()

    expect(metrics).toEqual([
      { minute: Math.floor((clockAt - 90_000) / 60_000) * 60_000, entries: 1, claims: 0 },
    ])
  })

  it("reports nothing and does not wake itself again for history older than the retention", () => {
    const { room, alarm, sql } = oldRoom(30 * hour, { METRICS_RETENTION_HOURS: "1" })
    sql.exec("DELETE FROM entries WHERE seq = 2", [])

    expect(room.onAlarm().metrics).toEqual([])
    expect(alarm.at).not.toBeNull()
    expect(alarm.at ?? 0).toBeGreaterThan(30 * hour)
  })
})

describe("overlay theme push", () => {
  it("sends a saved style to the overlays only, without a snapshot", () => {
    const { room, hub } = setup()
    const theme = { ...defaultOverlayTheme, accent: "#ff5500" }

    room.pushOverlayTheme(theme)

    expect(hub.overlayMessages.map((text) => JSON.parse(text))).toEqual([{ theme }])
    expect(hub.messages).toEqual([])
    expect(hub.viewerMessages).toEqual([])
  })
})

describe("winner form answers", () => {
  const retentionSeconds = 3600

  async function claimedRoom() {
    const context = setup(giveaway, random, {
      WINNER_FORM_RETENTION_SECONDS: String(retentionSeconds),
    })
    enterMany(context.room, ["1", "2", "3"])
    context.room.close(null)
    await context.room.draw(1, null)
    const winner = twitch(String(picks(context.sql)[0]?.platform_user_id))
    context.clock.advance(1000)
    expect(context.room.claim(0, winner, "rafflink", null)).toEqual({ kind: "claimed" })
    return { ...context, winner, claimedAt: context.clock.now() }
  }

  it("keeps the first sealed answers of a claimed winner and refuses a second sending", async () => {
    const { room, winner } = await claimedRoom()

    expect(room.saveWinnerAnswers(0, winner, "sealed-1")).toEqual({ kind: "saved" })
    expect(room.saveWinnerAnswers(0, winner, "sealed-2")).toEqual({ kind: "already-answered" })
    expect(room.winnerAnswers()).toEqual([{ n: 0, sealed: "sealed-1" }])
    expect(room.picks()[0]).toMatchObject({ answers: "sent", deliveredAt: null })
  })

  it("refuses answers before the claim, from another account and for an unknown pick", async () => {
    const { room, winner } = await drawnRoom()
    const other = twitch(winner.platformUserId === "1" ? "2" : "1")

    expect(room.picks()[0]?.answers).toBe("open")
    expect(room.saveWinnerAnswers(0, winner, "sealed")).toEqual({ kind: "not-claimed" })
    room.claim(0, winner, "rafflink", null)
    expect(room.saveWinnerAnswers(0, other, "sealed")).toEqual({ kind: "not-a-winner" })
    expect(room.saveWinnerAnswers(5, winner, "sealed")).toEqual({ kind: "not-a-winner" })
    expect(room.winnerAnswers()).toEqual([])
  })

  it("deletes the answers when the prize is marked delivered and still shows they were sent", async () => {
    const { room, winner, clock } = await claimedRoom()
    room.saveWinnerAnswers(0, winner, "sealed")
    clock.advance(10)

    expect(room.markDelivered(0)).toEqual({ kind: "delivered" })
    expect(room.markDelivered(0)).toEqual({ kind: "already-delivered" })
    expect(room.markDelivered(5)).toEqual({ kind: "unknown-pick" })
    expect(room.winnerAnswers()).toEqual([])
    expect(room.picks()[0]).toMatchObject({ answers: "sent", deliveredAt: clock.now() })
  })

  it("closes the form of a winner whose prize was marked delivered before they answered", async () => {
    const { room, winner } = await claimedRoom()

    room.markDelivered(0)

    expect(room.picks()[0]?.answers).toBe("closed")
    expect(room.saveWinnerAnswers(0, winner, "sealed")).toEqual({ kind: "form-closed" })
  })

  it("closes the form of a rerolled pick", async () => {
    const { room, winner } = await drawnRoom()

    expect((await room.reroll(0, null)).kind).toBe("rerolled")

    expect(room.picks()[0]?.answers).toBe("closed")
    expect(room.saveWinnerAnswers(0, winner, "sealed")).toEqual({ kind: "form-closed" })
  })

  it("refuses to mark an unclaimed pick delivered", async () => {
    const { room } = await drawnRoom()

    expect(room.markDelivered(0)).toEqual({ kind: "not-claimed" })
  })

  it("deletes the answers on the alarm WINNER_FORM_RETENTION_SECONDS after the claim", async () => {
    const { room, winner, clock, alarm, sql, claimedAt } = await claimedRoom()
    room.saveWinnerAnswers(0, winner, "sealed")
    const deadline = claimedAt + retentionSeconds * 1000

    clock.advance(deadline - 1 - clock.now())
    room.onAlarm()
    expect(room.winnerAnswers()).toHaveLength(1)
    expect(alarm.at).toBe(deadline)

    const info = spyOn(console, "info").mockImplementation(() => {})
    clock.advance(1)
    room.onAlarm()
    expect(info).toHaveBeenCalledWith("winner answers deleted", { giveawayId: "g1", count: 1 })
    info.mockRestore()
    expect(sql.exec("SELECT COUNT(*) AS c FROM winner_answers", [])[0]?.c).toBe(0)
    expect(room.picks()[0]?.answers).toBe("sent")
  })

  it("refuses answers once the retention time after the claim has passed", async () => {
    const { room, winner, clock, claimedAt } = await claimedRoom()

    clock.advance(claimedAt + retentionSeconds * 1000 - 1 - clock.now())
    expect(room.picks()[0]?.answers).toBe("open")
    clock.advance(1)

    expect(room.picks()[0]?.answers).toBe("closed")
    expect(room.saveWinnerAnswers(0, winner, "sealed")).toEqual({ kind: "form-closed" })
  })
})
