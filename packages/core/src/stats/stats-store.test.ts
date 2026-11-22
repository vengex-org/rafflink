import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { accountsSchema } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import { StatsStore } from "./stats-store.ts"
import { dayMs, minuteMs } from "./time.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
  METRICS_RETENTION_HOURS: "24",
  REFERRAL_SOURCES_PER_DAY_MAX: "2",
  REFERRAL_VISITS_PER_DAY_MAX: "5",
  ADMIN_STATS_DAYS: "14",
})

function setup() {
  const db = new Database(":memory:")
  db.exec(accountsSchema)
  return { db, store: new StatsStore(new BunSqliteAsyncSql(db), config) }
}

function addStreamer(db: Database, id: string, createdAt: number, name = id): void {
  db.run(
    "INSERT INTO streamers (id, platform, platform_user_id, login, display_name, created_at) VALUES (?, 'twitch', ?, ?, ?, ?)",
    [id, id, name, name, createdAt],
  )
}

function addGiveaway(
  db: Database,
  id: string,
  streamerId: string,
  createdAt: number,
  status = "open",
): void {
  db.run(
    "INSERT INTO giveaways (id, code, streamer_id, title, rules_json, status, claim_seconds, overlay_token, created_at) VALUES (?, ?, ?, ?, '{}', ?, 300, 'overlay', ?)",
    [id, id, streamerId, `title ${id}`, status, createdAt],
  )
}

describe("StatsStore minute counters", () => {
  it("adds counts to a minute that already has a row", async () => {
    const { store } = setup()
    const now = 10 * minuteMs
    await store.addMinutes([{ minute: now, entries: 3, claims: 1 }], now)

    await store.addMinutes([{ minute: now, entries: 2, claims: 0 }], now)

    expect(await store.minutes(0)).toEqual([{ minute: now, entries: 5, claims: 1 }])
  })

  it("returns only the minutes from the given instant, oldest first", async () => {
    const { store } = setup()
    const now = 10 * minuteMs
    await store.addMinutes(
      [
        { minute: now - minuteMs, entries: 1, claims: 0 },
        { minute: now - 3 * minuteMs, entries: 9, claims: 9 },
        { minute: now, entries: 2, claims: 0 },
      ],
      now,
    )

    expect(await store.minutes(now - minuteMs)).toEqual([
      { minute: now - minuteMs, entries: 1, claims: 0 },
      { minute: now, entries: 2, claims: 0 },
    ])
  })

  it("deletes minutes older than the retention when it writes", async () => {
    const { store } = setup()
    const retention = 24 * 60 * minuteMs
    const now = 2 * retention
    await store.addMinutes(
      [{ minute: now - retention - minuteMs, entries: 1, claims: 0 }],
      now - retention - minuteMs,
    )

    await store.addMinutes([{ minute: now - retention, entries: 1, claims: 0 }], now)

    expect(await store.minutes(0)).toEqual([{ minute: now - retention, entries: 1, claims: 0 }])
  })

  it("writes more minutes than one statement holds", async () => {
    const { store } = setup()
    const now = 100 * minuteMs
    const counts = Array.from({ length: 75 }, (_, index) => ({
      minute: now - index * minuteMs,
      entries: index + 1,
      claims: 0,
    }))

    await store.addMinutes(counts, now)

    expect(await store.minutes(0)).toHaveLength(75)
  })
})

describe("StatsStore referrals", () => {
  it("counts visits per label and day and lists the busiest first", async () => {
    const { store } = setup()
    const now = 20 * dayMs
    await store.countReferral("reddit", now)
    await store.countReferral("reddit", now + 1000)
    await store.countReferral("reddit", now - dayMs)
    await store.countReferral("blog", now)

    expect(await store.topReferrals(now - 2 * dayMs, 10)).toEqual([
      { ref: "reddit", visits: 3 },
      { ref: "blog", visits: 1 },
    ])
    expect(await store.topReferrals(now, 10)).toEqual([
      { ref: "reddit", visits: 2 },
      { ref: "blog", visits: 1 },
    ])
  })

  it("ignores a new label once the day holds the most it may, and keeps counting the known ones", async () => {
    const { store } = setup()
    const now = 20 * dayMs
    await store.countReferral("a", now)
    await store.countReferral("b", now)

    await store.countReferral("c", now)
    await store.countReferral("a", now)

    expect(await store.topReferrals(now, 10)).toEqual([
      { ref: "a", visits: 2 },
      { ref: "b", visits: 1 },
    ])
  })

  it("reports whether a visit was counted", async () => {
    const { store } = setup()
    const now = 20 * dayMs

    expect(await store.countReferral("a", now)).toBe("counted")
    expect(await store.countReferral("b", now)).toBe("counted")
    expect(await store.countReferral("c", now)).toBe("skipped")
  })

  it("writes nothing once the day's visits reached the most, for known and new labels, and counts again the next day", async () => {
    const { db, store } = setup()
    const now = 20 * dayMs
    for (let visit = 0; visit < 3; visit++) await store.countReferral("a", now)
    await store.countReferral("b", now)
    await store.countReferral("b", now)

    expect(await store.countReferral("a", now)).toBe("skipped")
    expect(await store.countReferral("b", now)).toBe("skipped")
    expect(await store.countReferral("c", now)).toBe("skipped")

    expect(db.query("SELECT SUM(count) AS total FROM referrals").get()).toEqual({ total: 5 })
    expect(await store.countReferral("a", now + dayMs)).toBe("counted")
  })

  it("counts a new label on the next day even when the previous day was full", async () => {
    const { store } = setup()
    const now = 20 * dayMs
    await store.countReferral("a", now)
    await store.countReferral("b", now)

    await store.countReferral("c", now + dayMs)

    expect(await store.topReferrals(now + dayMs, 10)).toEqual([{ ref: "c", visits: 1 }])
  })

  it("deletes the days past the window when it counts", async () => {
    const { store } = setup()
    const now = 40 * dayMs
    await store.countReferral("old", now - 15 * dayMs)

    await store.countReferral("new", now)

    expect(await store.topReferrals(0, 10)).toEqual([{ ref: "new", visits: 1 }])
  })

  it("lists no more than the limit", async () => {
    const { store } = setup()
    const now = 20 * dayMs
    await store.countReferral("a", now)
    await store.countReferral("b", now)

    expect(await store.topReferrals(now, 1)).toEqual([{ ref: "a", visits: 1 }])
  })
})

describe("StatsStore aggregates", () => {
  it("counts giveaways and new streamers per day, skipping days with none", async () => {
    const { db, store } = setup()
    const day = 20 * dayMs
    addStreamer(db, "s1", day + 5)
    addStreamer(db, "s2", day + dayMs * 2)
    addStreamer(db, "s3", day + dayMs * 2 + 9)
    addGiveaway(db, "g1", "s1", day + 10)
    addGiveaway(db, "g2", "s1", day + 20)
    addGiveaway(db, "old", "s1", day - dayMs)

    expect(await store.giveawaysPerDay(day)).toEqual([{ day, count: 2 }])
    expect(await store.streamersPerDay(day)).toEqual([
      { day, count: 1 },
      { day: day + 2 * dayMs, count: 2 },
    ])
  })

  it("counts a streamer as returning when the second giveaway came within the window of the first", async () => {
    const { db, store } = setup()
    const start = 20 * dayMs
    for (const id of ["early", "late", "single", "boundary"]) addStreamer(db, id, start)
    addGiveaway(db, "e1", "early", start)
    addGiveaway(db, "e2", "early", start + 29 * dayMs)
    addGiveaway(db, "l1", "late", start)
    addGiveaway(db, "l2", "late", start + 30 * dayMs + 1)
    addGiveaway(db, "s1", "single", start)
    addGiveaway(db, "b1", "boundary", start)
    addGiveaway(db, "b2", "boundary", start + 30 * dayMs)
    addGiveaway(db, "b3", "boundary", start + 31 * dayMs)

    expect(await store.returningStreamers(30 * dayMs)).toBe(2)
  })

  it("counts nobody as returning without giveaways", async () => {
    const { store } = setup()

    expect(await store.returningStreamers(30 * dayMs)).toBe(0)
  })

  it("lists the newest open giveaways with the streamer's name and counts all open ones", async () => {
    const { db, store } = setup()
    addStreamer(db, "s1", 1, "Ann")
    addGiveaway(db, "g1", "s1", 100)
    addGiveaway(db, "g2", "s1", 300)
    addGiveaway(db, "g3", "s1", 200)
    addGiveaway(db, "done", "s1", 400, "drawn")

    const open = await store.openGiveaways(2)

    expect(open.total).toBe(3)
    expect(open.giveaways.map((giveaway) => [giveaway.id, giveaway.streamerName])).toEqual([
      ["g2", "Ann"],
      ["g3", "Ann"],
    ])
  })

  it("lists none when the fan-out limit is zero", async () => {
    const { db, store } = setup()
    addStreamer(db, "s1", 1)
    addGiveaway(db, "g1", "s1", 100)

    expect(await store.openGiveaways(0)).toEqual({ total: 1, giveaways: [] })
  })
})
