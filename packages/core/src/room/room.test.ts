import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { resolveConfig } from "../config.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import { drawWinners } from "../lib/draw.ts"
import type { Alarm, Clock, Instant, LiveHub, Random, SqlRow, SqlValue, SyncSql } from "../ports.ts"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import { idleChat } from "../../test/idle-chat.ts"
import {
  GiveawayRoom,
  type GiveawayInit,
  type RoomViewer,
  type ViewerPush,
} from "./giveaway-room.ts"
import { applyMigrations } from "./migrate.ts"
import { roomMigrations } from "./migrations.ts"
import {
  entrantsAfterSql,
  entryOfSql,
  headSeqSql,
  lastNamesSql,
  recentEntriesCountSql,
  lastClaimDeadlineSql,
  lastStandingDeadlineSql,
  undrawnEntrantSql,
} from "./queries.ts"

const config = resolveConfig({
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
})

const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

const giveaway: GiveawayInit = {
  id: "g1",
  platform: "twitch",
  broadcasterId: "broadcaster",
  title: "Giveaway",
  code: "ABCDE",
  rules,
  claimSeconds: 300,
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
  readonly viewerMessages: string[] = []
  broadcast(json: string): void {
    this.messages.push(json)
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

function viewer(id: string, overrides: Partial<RoomViewer> = {}): RoomViewer {
  return {
    platformUserId: id,
    login: `login${id}`,
    displayName: `Name${id}`,
    isFollower: false,
    subTier: null,
    accountAgeDays: 100,
    ...overrides,
  }
}

function setup(init: GiveawayInit = giveaway) {
  const db = new Database(":memory:")
  const sql = new RecordingSql(new BunSqliteSyncSql(db))
  applyMigrations(sql, roomMigrations)
  const clock = new TestClock(0)
  const alarm = new TestAlarm()
  const hub = new TestHub()
  const room = new GiveawayRoom({ sql, alarm, live: hub, clock, random, config, chat: idleChat })
  room.init(init)
  return { room, sql, clock, alarm, hub }
}

function enterMany(room: GiveawayRoom, ids: readonly string[]): void {
  for (const id of ids) room.enter(viewer(id))
}

function picks(sql: SyncSql): SqlRow[] {
  return sql.exec("SELECT n, platform_user_id, rerolled, claimed_via FROM draws ORDER BY n", [])
}

function twitch(id: string) {
  return { platform: "twitch", platformUserId: id }
}

async function drawnRoom() {
  const context = setup()
  enterMany(context.room, ["1", "2", "3"])
  context.room.close()
  await context.room.draw(1)
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
    const first = room.enter(viewer("1"))
    clock.advance(5000)
    const second = room.enter(viewer("1", { isFollower: true, subTier: 3 }))

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
    expect(room.close()).toEqual({ kind: "closed" })

    expect(room.enter(viewer("1"))).toEqual({ kind: "closed" })
    expect(room.summary()).toMatchObject({ status: "closed", entrantCount: 0 })
  })

  it("refuses entries from the end time on, before the alarm has run", () => {
    const { room, clock } = setup({ ...giveaway, closesAt: 5000 })
    clock.advance(4999)
    expect(room.enter(viewer("1")).kind).toBe("entered")
    clock.advance(1)
    expect(room.enter(viewer("2"))).toEqual({ kind: "closed" })
  })

  it("closing twice reports the status the second time", () => {
    const { room } = setup()
    room.close()
    expect(room.close()).toEqual({ kind: "not-open", status: "closed" })
  })

  it("writes nothing for a viewer who is not eligible", () => {
    const { room, sql } = setup({ ...giveaway, rules: { ...rules, subsOnly: true } })

    expect(room.enter(viewer("1"))).toEqual({ kind: "not-eligible", reason: "subs-only" })
    expect(room.enter(viewer("broadcaster", { subTier: 1 }))).toEqual({
      kind: "not-eligible",
      reason: "broadcaster",
    })
    expect(room.summary()).toMatchObject({ entrantCount: 0, ticketTotal: 0 })
    expect(sql.exec("SELECT COUNT(*) AS c FROM entries", [])[0]?.c).toBe(0)
  })

  it("gives the tickets of the best group, not their sum", () => {
    const { room } = setup()
    const outcome = room.enter(viewer("1", { isFollower: true, subTier: 2 }))
    expect(outcome).toMatchObject({ entry: { group: "sub_t2", tickets: 4 } })
  })

  it("keeps the first room when init runs again", () => {
    const { room } = setup()
    room.enter(viewer("1"))
    room.init({ ...giveaway, id: "other", claimSeconds: 10 })
    expect(room.summary()).toMatchObject({ status: "open", entrantCount: 1 })
  })

  it("keeps the counters equal to the entries", () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.enter(viewer("2", { isFollower: true }))
    room.enter(viewer("4", { isFollower: true }))
    room.close()
    room.enter(viewer("5"))

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
  it("stores the seed and the picks the seed produces", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close()

    const outcome = await room.draw(5)

    expect(outcome.kind).toBe("drawn")
    const stored = sql.exec("SELECT seed, status FROM room_state", [])[0]
    expect(stored?.status).toBe("drawn")
    expect(stored?.seed).toEqual(new Uint8Array(32).fill(7))
    const entries = ["1", "2", "3"].map((id) => ({ ...twitch(id), tickets: 1 }))
    const expected = await drawWinners(new Uint8Array(32).fill(7), entries, 5)
    expect(expected).toHaveLength(3)
    expect(outcome).toEqual({ kind: "drawn", winners: expected })
    expect(picks(sql).map((row) => row.platform_user_id)).toEqual(
      expected.map((winner) => winner.platformUserId),
    )
  })

  it("refuses a draw before the room is closed", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1"])
    expect(await room.draw(1)).toEqual({ kind: "not-closed" })
    expect(picks(sql)).toEqual([])
    expect(room.summary().status).toBe("open")
  })

  it("refuses a second draw and keeps the first picks", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close()
    await room.draw(1)
    const before = picks(sql)

    expect(await room.draw(2)).toEqual({ kind: "already-drawn" })
    expect(picks(sql)).toEqual(before)
  })

  it("lets only one of two simultaneous draws through", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close()

    const outcomes = await Promise.all([room.draw(1), room.draw(2)])

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual(["already-drawn", "drawn"])
    const drawn = outcomes.find((outcome) => outcome.kind === "drawn")
    expect(sql.exec("SELECT COUNT(*) AS c FROM draws", [])[0]?.c).toBe(
      drawn?.kind === "drawn" ? drawn.winners.length : -1,
    )
  })
})

describe("GiveawayRoom picks", () => {
  it("lists every pick with its identity, rerolled ones included", async () => {
    const { room, winner } = await drawnRoom()
    await room.reroll(0)

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

    const outcome = await room.reroll(0)

    expect(outcome).toMatchObject({ kind: "rerolled", replaced: 0, winner: { n: 800_100 } })
  })

  it("reroll adds the next pick and marks the old one", async () => {
    const { room, sql } = await drawnRoom()
    const first = picks(sql)[0]

    const outcome = await room.reroll(0)

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
    await room.reroll(0)
    await room.reroll(1)
    expect(await room.reroll(2)).toEqual({ kind: "no-entrants-left" })

    const ids = picks(sql).map((row) => row.platform_user_id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toHaveLength(3)
  })

  it("a second reroll of the same pick adds nothing", async () => {
    const { room, sql } = await drawnRoom()
    await room.reroll(0)

    expect(await room.reroll(0)).toEqual({ kind: "already-rerolled" })
    expect(picks(sql)).toHaveLength(2)
  })

  it("two simultaneous rerolls of one pick give one new pick", async () => {
    const { room, sql } = await drawnRoom()

    const outcomes = await Promise.all([room.reroll(0), room.reroll(0)])

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual([
      "already-rerolled",
      "rerolled",
    ])
    expect(picks(sql)).toHaveLength(2)
  })

  it("keeps a claimed pick and refuses to reroll it", async () => {
    const { room, sql } = await drawnRoom()
    const winnerId = String(picks(sql)[0]?.platform_user_id)
    room.claim(0, twitch(winnerId), "rafflink")

    expect(await room.reroll(0)).toEqual({ kind: "already-claimed" })
    expect(picks(sql)).toHaveLength(1)
  })

  it("refuses a reroll before a draw and for a pick that does not exist", async () => {
    const closed = setup()
    closed.room.close()
    expect(await closed.room.reroll(0)).toEqual({ kind: "not-drawn" })

    const { room } = await drawnRoom()
    expect(await room.reroll(9)).toEqual({ kind: "unknown-pick" })
  })
})

describe("GiveawayRoom claim", () => {
  it("lets the first claim win and refuses the second", async () => {
    const { room, sql, winner } = await drawnRoom()

    expect(room.claim(0, winner, "rafflink")).toEqual({ kind: "claimed" })
    expect(room.claim(0, winner, "chat")).toEqual({ kind: "already-claimed" })
    expect(picks(sql)[0]?.claimed_via).toBe("rafflink")
  })

  it("records the channel a claim came through", async () => {
    const { room, sql, winner } = await drawnRoom()
    room.claim(0, winner, "manual")
    expect(picks(sql)[0]?.claimed_via).toBe("manual")
  })

  it("refuses a claim after the deadline and accepts it on the deadline", async () => {
    const late = await drawnRoom()
    late.clock.advance(300_001)
    expect(late.room.claim(0, late.winner, "rafflink")).toEqual({ kind: "expired" })
    expect(picks(late.sql)[0]?.claimed_via).toBeNull()

    const onTime = await drawnRoom()
    onTime.clock.advance(300_000)
    expect(onTime.room.claim(0, onTime.winner, "rafflink")).toEqual({ kind: "claimed" })
  })

  it("refuses a claim by someone who was not picked", async () => {
    const { room, winner } = await drawnRoom()
    const other = twitch(winner.platformUserId === "1" ? "2" : "1")
    expect(room.claim(0, other, "rafflink")).toEqual({ kind: "not-a-winner" })
    expect(room.claim(7, winner, "rafflink")).toEqual({ kind: "not-a-winner" })
  })

  it("refuses a claim on a rerolled pick", async () => {
    const { room, winner } = await drawnRoom()
    await room.reroll(0)
    expect(room.claim(0, winner, "rafflink")).toEqual({ kind: "rerolled" })
  })
})

describe("GiveawayRoom roles", () => {
  it("gives a VIP the VIP tickets once the list is stored", () => {
    const { room } = setup()
    room.replaceRoles(["7"], ["8"])

    expect(room.enter(viewer("7"))).toMatchObject({ entry: { group: "vip", tickets: 6 } })
    expect(room.enter(viewer("8"))).toMatchObject({ entry: { group: "moderator", tickets: 7 } })
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

describe("GiveawayRoom alarm", () => {
  it("closes the room at the end time and asks for a status mirror", () => {
    const { room, clock, alarm } = setup({ ...giveaway, closesAt: 5000 })
    expect(room.onAlarm()).toEqual({ refreshRoles: true, mirrorStatus: null })
    room.replaceRoles([], [])
    expect(alarm.at).toBe(5000)

    clock.advance(5000)
    const duties = room.onAlarm()

    expect(room.summary().status).toBe("closed")
    expect(duties).toEqual({ refreshRoles: false, mirrorStatus: "closed" })
    expect(room.enter(viewer("1"))).toEqual({ kind: "closed" })
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
    room.close()
    clock.advance(300_000)
    expect(room.onAlarm().refreshRoles).toBe(false)
  })

  it("retries a pending mirror after the retry delay until it is marked", () => {
    const { room, clock, alarm } = setup()
    room.replaceRoles([], [])
    room.close()
    expect(room.onAlarm().mirrorStatus).toBeNull()
    expect(alarm.at).toBe(30_000)

    clock.advance(30_000)
    expect(room.onAlarm().mirrorStatus).toBe("closed")
    room.markMirrored("closed")
    clock.advance(30_000)
    expect(room.onAlarm().mirrorStatus).toBeNull()
    expect(alarm.at).toBeNull()
  })

  it("keeps a newer status pending when an older one was mirrored", async () => {
    const { room, clock } = setup()
    enterMany(room, ["1"])
    room.close()
    await room.draw(1)

    room.markMirrored("closed")
    clock.advance(30_000)

    expect(room.onAlarm().mirrorStatus).toBe("drawn")
  })
})

describe("GiveawayRoom live push", () => {
  it("pushes at most once per interval and sends the held update when the alarm fires", () => {
    const { room, clock, hub, alarm } = setup()
    room.replaceRoles([], [])

    room.enter(viewer("1"))
    clock.advance(100)
    room.enter(viewer("2"))
    clock.advance(100)
    room.enter(viewer("3"))

    expect(hub.messages).toHaveLength(1)
    expect(JSON.parse(hub.messages[0] ?? "")).toMatchObject({ entrantCount: 1 })
    expect(alarm.at).toBe(1000)

    clock.advance(800)
    room.onAlarm()
    expect(hub.messages).toHaveLength(2)
    expect(JSON.parse(hub.messages[1] ?? "")).toMatchObject({ entrantCount: 3 })

    clock.advance(10)
    room.enter(viewer("4"))
    expect(hub.messages).toHaveLength(2)
  })

  it("pushes again once the interval has passed", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"))
    clock.advance(1000)
    room.enter(viewer("2"))
    expect(hub.messages).toHaveLength(2)
  })

  it("still updates the alarm when the push fails", () => {
    const { room, alarm, hub } = setup({ ...giveaway, closesAt: 9000 })
    room.replaceRoles([], [])
    spyOn(console, "warn").mockImplementation(() => {})
    spyOn(hub, "broadcast").mockImplementation(() => {
      throw new Error("socket gone")
    })

    room.enter(viewer("1"))

    expect(alarm.at).toBe(9000)
    expect(room.summary().entrantCount).toBe(1)
  })

  it("shows the newest names, the rate, the winners and the failure counters", async () => {
    const { room, clock } = setup()
    spyOn(console, "warn").mockImplementation(() => {})
    for (const id of ["1", "2", "3"]) {
      clock.advance(1000)
      room.enter(viewer(id))
    }
    room.recordFailure("role-refresh", new Error("helix 503"))
    room.recordFailure("eventsub", new Error("socket closed"))
    room.close()
    await room.draw(1)

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

  it("shows how a winner claimed and which pick was rerolled", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close()
    await room.draw(1)
    await room.reroll(0)
    room.claim(1, twitch(String(picks(sql)[1]?.platform_user_id)), "chat")

    const claims = room.liveSnapshot().winners.map((winner) => winner.claim)

    expect(claims).toEqual([{ state: "rerolled" }, { state: "claimed", via: "chat" }])
  })
})

function pushes(hub: TestHub) {
  return hub.messages.map((message) => JSON.parse(message).entrantsAfter)
}

describe("GiveawayRoom entrants", () => {
  it("numbers entries from 1 in the order they were written and lists them in that order", () => {
    const { room } = setup()
    room.enter(viewer("30", { subTier: 1 }))
    room.enter(viewer("10"))
    room.enter(viewer("20", { isFollower: true }))

    expect(room.entrants({ afterSeq: 0, limit: 10 })).toEqual([
      { seq: 1, login: "login30", displayName: "Name30", tickets: 3, group: "sub_t1" },
      { seq: 2, login: "login10", displayName: "Name10", tickets: 1, group: "viewer" },
      { seq: 3, login: "login20", displayName: "Name20", tickets: 2, group: "follower" },
    ])
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

    room.enter(viewer("1", { isFollower: true }))
    room.enter(viewer("1", { isFollower: true }))
    room.enter(viewer("2"))
    room.enter(viewer("3", { isFollower: true }))

    expect(room.entrants({ afterSeq: 0, limit: 10 }).map((row) => [row.seq, row.login])).toEqual([
      [1, "login1"],
      [2, "login3"],
    ])
  })

  it("names the entry of each winner by its sequence number", async () => {
    const { room, sql } = setup()
    enterMany(room, ["1", "2", "3"])
    room.close()
    await room.draw(2)
    const pickedIds = picks(sql).map((pick) => String(pick.platform_user_id))

    const winners = room.liveSnapshot().winners.map((winner) => winner.entrySeq)

    expect(winners).toEqual(pickedIds.map(Number))
  })
})

describe("GiveawayRoom live push of entrants", () => {
  it("carries no rows in the first push of a room object and the entrants since the last push after that", () => {
    const { room, clock, hub } = setup()

    room.enter(viewer("1"))
    clock.advance(1000)
    room.enter(viewer("2"))
    room.enter(viewer("3"))
    clock.advance(1000)
    room.onAlarm()

    const [first, second, third] = pushes(hub)
    expect(first).toEqual({ fromSeq: 1, rows: [], truncated: false })
    expect(second).toEqual({
      fromSeq: 1,
      rows: [{ seq: 2, login: "login2", displayName: "Name2", tickets: 1, group: "viewer" }],
      truncated: false,
    })
    expect(third).toMatchObject({ fromSeq: 2, truncated: false })
    expect(third.rows.map((row: { seq: number }) => row.seq)).toEqual([3])
  })

  it("sends the entrants of a held push when the alarm fires, not one per entry", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"))
    clock.advance(100)
    room.enter(viewer("2"))
    clock.advance(100)
    room.enter(viewer("3"))
    clock.advance(800)

    room.onAlarm()

    expect(hub.messages).toHaveLength(2)
    expect(pushes(hub)[1].rows.map((row: { seq: number }) => row.seq)).toEqual([2, 3])
  })

  it("marks a push truncated when more entrants arrived than one push carries and continues after them", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"))
    clock.advance(100)
    enterMany(room, ["2", "3", "4"])
    clock.advance(900)
    room.onAlarm()
    clock.advance(1000)
    room.enter(viewer("5"))

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
    room.enter(viewer("1"))
    clock.advance(100)
    enterMany(room, ["2", "3"])
    clock.advance(900)
    room.onAlarm()

    expect(pushes(hub)[1]).toMatchObject({ fromSeq: 1, truncated: false })
    expect(pushes(hub)[1].rows).toHaveLength(2)
  })

  it("keeps the same rows for the next push when a push fails", () => {
    const { room, clock, hub } = setup()
    room.enter(viewer("1"))
    clock.advance(1000)
    spyOn(console, "warn").mockImplementation(() => {})
    const broadcast = spyOn(hub, "broadcast").mockImplementationOnce(() => {
      throw new Error("socket gone")
    })
    room.enter(viewer("2"))
    broadcast.mockRestore()
    clock.advance(1000)

    room.enter(viewer("3"))

    expect(
      pushes(hub)
        .at(-1)
        .rows.map((row: { seq: number }) => row.seq),
    ).toEqual([2, 3])
  })

  it("keeps the entrants out of the snapshot a GET returns", () => {
    const { room } = setup()
    room.enter(viewer("1"))

    expect(room.liveSnapshot()).not.toHaveProperty("entrantsAfter")
  })
})

describe("GiveawayRoom failures", () => {
  it("logs the giveaway id and the cause and never a viewer name", () => {
    const { room } = setup()
    room.enter(viewer("1", { login: "secretlogin", displayName: "SecretName" }))
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
    room.enter(viewer("1", { subTier: 2 }))

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

    room.close()

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

    room.claim(0, winner, "chat")

    expect(lastViewerPush(hub)).toMatchObject({
      finished: true,
      winners: [{ n: 0, claim: { state: "claimed", via: "chat" } }],
    })
  })

  it("pushes the replaced pick as rerolled next to the new one, and the giveaway is not finished", async () => {
    const { room, hub } = await drawnRoom()

    await room.reroll(0)

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
      chat: idleChat,
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
    await room.reroll(0)

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
    closed.room.close()
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
    room.enter(viewer("1"))
    room.close()
    await room.draw(1)
    room.markMirrored("drawn")
    expect(room.summary().finished).toBe(false)

    clock.advance(300_000)
    room.onAlarm()
    expect(lastViewerPush(hub).finished).toBe(false)
    expect(alarm.at).toBe(300_001)
    clock.advance(1)
    room.onAlarm()

    expect(room.summary().finished).toBe(true)
    expect(lastViewerPush(hub).finished).toBe(true)
    expect(alarm.at).toBeNull()
  })

  it("is finished and pushed once the reroll window after the last claim time has passed", async () => {
    const { room, clock, alarm, hub } = await drawnRoom()
    room.markMirrored("drawn")
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
    expect(alarm.at).toBeNull()
  })

  it("tells the live snapshot when the reroll window is over and pushes it to the live pages", async () => {
    const { room, clock, hub } = await drawnRoom()
    room.markMirrored("drawn")
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
    room.markMirrored("drawn")
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
      chat: idleChat,
    })
    clock.advance(899_001)

    evicted.onAlarm()

    expect(JSON.parse(hub.messages.at(-1) ?? "null")).toMatchObject({ rerollOpen: false })
  })

  it("keeps the reroll window of an unclaimed pick open to the end of a later pick's window after that pick claimed", async () => {
    const { room, sql, clock } = setup()
    enterMany(room, ["1", "2", "3", "4"])
    room.close()
    await room.draw(2)
    clock.advance(300_001)
    await room.reroll(1)
    const later = twitch(String(picks(sql)[2]?.platform_user_id))
    clock.advance(299_999)
    expect(room.claim(2, later, "chat").kind).toBe("claimed")

    clock.advance(399_999)
    expect(room.liveSnapshot().rerollOpen).toBe(true)
    expect(room.summary().finished).toBe(false)
    clock.advance(200_003)
    expect(room.liveSnapshot().rerollOpen).toBe(false)
    expect(room.summary().finished).toBe(true)
    expect(await room.reroll(0)).toEqual({ kind: "reroll-window-over" })
  })

  it("keeps the live snapshot closed for rerolls when every entrant was drawn", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"))
    room.close()
    await room.draw(1)
    clock.advance(300_001)

    expect(room.liveSnapshot().rerollOpen).toBe(false)
  })

  it("refuses a reroll that started inside the window but finished after it ended", async () => {
    const { room, sql, clock } = await drawnRoom()
    clock.advance(900_000)

    const started = room.reroll(0)
    clock.advance(1)

    expect(await started).toEqual({ kind: "reroll-window-over" })
    expect(picks(sql)).toHaveLength(1)
  })

  it("keeps the live snapshot closed for rerolls while entries are open or the draw has no pick to replace", async () => {
    const open = setup()
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat")

    expect([open.room, claimed.room].map((room) => room.liveSnapshot().rerollOpen)).toEqual([
      false,
      false,
    ])
  })

  it("tells the live snapshot nobody is left to reroll while the window is still open", async () => {
    const { room, clock } = setup()
    room.enter(viewer("1"))
    room.close()
    await room.draw(1)
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
    room.enter(viewer("1"))
    room.close()
    await room.draw(1)
    clock.advance(900_001)

    expect(room.liveSnapshot()).toMatchObject({ rerollOpen: false, rerollBlocked: "window-over" })
  })

  it("gives no reroll reason before the draw or once every pick is claimed", async () => {
    const open = setup()
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat")

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

    expect(await early.room.reroll(0)).toMatchObject({ kind: "rerolled", replaced: 0 })
    expect(await late.room.reroll(0)).toEqual({ kind: "reroll-window-over" })
    expect(picks(late.sql)).toHaveLength(1)
  })

  it("is finished once every pick is claimed, and for a draw nobody won", async () => {
    const claimed = await drawnRoom()
    claimed.room.claim(0, claimed.winner, "chat")
    const empty = setup()
    empty.room.close()
    await empty.room.draw(1)

    expect(claimed.room.summary().finished).toBe(true)
    expect(empty.room.summary().finished).toBe(true)
  })

  it("is not finished after a reroll replaced an expired pick with a waiting one", async () => {
    const rerolled = await drawnRoom()
    rerolled.clock.advance(300_001)

    await rerolled.room.reroll(0)

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
