import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { explainPlan, secureRandom, sqlRows, TestAlarm, TestClock } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import { applyMigrations } from "../room/migrate.ts"
import type { EntryAttempt } from "../viewer/outcome.ts"
import { queueMigrations } from "./migrations.ts"
import { nextQueuedSql, oldestDoneSql, oldestQueuedSql, expiredQueuedSql } from "./queries.ts"
import { TokenQueue, type QueuedCode } from "./token-queue.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
  QUEUE_START_RATE_PER_SECOND: "4",
  QUEUE_MIN_RATE_PER_SECOND: "1",
  QUEUE_MAX_RATE_PER_SECOND: "8",
  QUEUE_COOLDOWN_SECONDS: "30",
  QUEUE_CODE_MAX_AGE_SECONDS: "300",
})

const entered: EntryAttempt = {
  kind: "final",
  outcome: { kind: "entered", entry: { group: "viewer", tickets: 1, enteredAt: 1 } },
  userId: "1",
}

type Process = (item: QueuedCode) => Promise<EntryAttempt>

function setup(process: Process = async () => entered) {
  const db = new Database(":memory:")
  const sql = new BunSqliteSyncSql(db)
  applyMigrations(sql, queueMigrations)
  const clock = new TestClock(1_000_000)
  const alarm = new TestAlarm()
  const calls: QueuedCode[] = []
  const queue = new TokenQueue({
    sql,
    alarm,
    clock,
    random: secureRandom,
    config,
    process: (queued) => {
      calls.push(queued)
      return process(queued)
    },
  })
  return { queue, db, clock, alarm, calls }
}

function item(code: string, giveawayId = "g1"): QueuedCode {
  return { code, giveawayId, nonce: `nonce-${code}` }
}

function rowCount(db: Database): number {
  return sqlRows(db, "SELECT ticket FROM token_queue").length
}

afterEach(() => {
  spyOn(console, "warn").mockRestore()
  spyOn(console, "error").mockRestore()
})

describe("TokenQueue results", () => {
  it("keeps a result until it is polled and then deletes the row", async () => {
    const { queue, db } = setup()
    const { ticket } = queue.enqueue(item("c1"), "unavailable")

    expect(queue.poll(ticket)).toEqual({ kind: "waiting" })
    await queue.onAlarm()
    expect(rowCount(db)).toBe(1)

    expect(queue.poll(ticket)).toEqual({ kind: "done", outcome: entered.outcome, userId: "1" })
    expect(rowCount(db)).toBe(0)
    expect(queue.poll(ticket)).toEqual({ kind: "gone" })
  })

  it("reports an unknown ticket as gone", () => {
    expect(setup().queue.poll("nope")).toEqual({ kind: "gone" })
  })

  it("keeps each kind of final outcome through the stored JSON", async () => {
    const outcomes = [
      entered.outcome,
      { kind: "already-in", entry: { group: "sub_t2", tickets: 4, enteredAt: 9 } },
      { kind: "not-eligible", reason: "subs-only" },
      { kind: "closed" },
      { kind: "try-again" },
      { kind: "invalid-state" },
    ] as const
    for (const outcome of outcomes) {
      const { queue } = setup(async () => ({ kind: "final", outcome, userId: null }))
      const { ticket } = queue.enqueue(item("c"), "unavailable")
      await queue.onAlarm()

      expect(queue.poll(ticket)).toEqual({ kind: "done", outcome, userId: null })
    }
  })

  it("keeps the verified user of a result and nothing for a queued row", async () => {
    const { queue, db } = setup()
    const { ticket } = queue.enqueue(item("c1"), "unavailable")
    const userIds = () => sqlRows(db, "SELECT user_id FROM token_queue").map((row) => row.user_id)

    expect(userIds()).toEqual([null])
    await queue.onAlarm()

    expect(userIds()).toEqual(["1"])
    expect(queue.poll(ticket)).toMatchObject({ kind: "done", userId: "1" })
  })

  it("processes the code with its giveaway id and nonce", async () => {
    const { queue, calls } = setup()
    queue.enqueue({ code: "c1", giveawayId: "g7", nonce: "n7" }, "unavailable")

    await queue.onAlarm()

    expect(calls.map(({ code, giveawayId, nonce }) => ({ code, giveawayId, nonce }))).toEqual([
      { code: "c1", giveawayId: "g7", nonce: "n7" },
    ])
  })
})

describe("TokenQueue age limit", () => {
  it("drops a code older than the maximum age, deletes its row and counts it", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { queue, db, clock, calls } = setup()
    const { ticket } = queue.enqueue(item("secret-code", "g9"), "unavailable")
    clock.advance(config.queueCodeMaxAgeSeconds * 1000 + 1)

    await queue.onAlarm()

    expect(calls).toHaveLength(0)
    expect(rowCount(db)).toBe(0)
    expect(queue.stats().dropped).toBe(1)
    expect(queue.poll(ticket)).toEqual({ kind: "gone" })
    expect(warn).toHaveBeenCalledWith("queue drop", { giveawayId: "g9" })
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-code")
    warn.mockRestore()
  })

  it("keeps a code of exactly the maximum age", async () => {
    const { queue, clock, calls } = setup()
    queue.enqueue(item("c1"), "unavailable")
    clock.advance(config.queueCodeMaxAgeSeconds * 1000)

    await queue.onAlarm()

    expect(calls).toHaveLength(1)
    expect(queue.stats().dropped).toBe(0)
  })

  it("deletes a result nobody polled after the maximum age", async () => {
    const { queue, db, clock } = setup()
    queue.enqueue(item("c1"), "unavailable")
    await queue.onAlarm()
    clock.advance(config.queueCodeMaxAgeSeconds * 1000 + 1)

    await queue.onAlarm()

    expect(rowCount(db)).toBe(0)
    expect(queue.stats()).toMatchObject({ abandonedResults: 1, dropped: 0 })
  })
})

describe("TokenQueue rate", () => {
  it("processes at most the current rate of codes per pass, oldest first", async () => {
    const { queue, clock, calls } = setup()
    for (const code of ["c1", "c2", "c3", "c4", "c5", "c6"]) {
      queue.enqueue(item(code), "unavailable")
      clock.advance(1)
    }

    await queue.onAlarm()

    expect(calls.map((call) => call.code)).toEqual(["c1", "c2", "c3", "c4"])
    expect(queue.stats().queued).toBe(2)
  })

  it("doubles the rate after a clean pass, up to the maximum", async () => {
    const { queue } = setup()
    queue.enqueue(item("c1"), "unavailable")

    await queue.onAlarm()
    expect(queue.stats().ratePerSecond).toBe(8)

    queue.enqueue(item("c2"), "unavailable")
    await queue.onAlarm()
    expect(queue.stats().ratePerSecond).toBe(8)
  })

  it("halves the rate and starts the cooldown after a rate limited code", async () => {
    const { queue, clock } = setup(async () => ({ kind: "deferred", cause: "rate-limited" }))
    queue.enqueue(item("c1"), "unavailable")

    await queue.onAlarm()

    expect(queue.stats()).toMatchObject({
      ratePerSecond: 2,
      cooldownUntil: clock.now() + config.queueCooldownSeconds * 1000,
      queued: 1,
    })
  })

  it("never slows below the minimum rate", async () => {
    const { queue, clock } = setup(async () => ({ kind: "deferred", cause: "rate-limited" }))
    queue.enqueue(item("c1"), "unavailable")

    for (let pass = 0; pass < 5; pass++) {
      await queue.onAlarm()
      clock.advance(config.queueCooldownSeconds * 1000)
    }

    expect(queue.stats().ratePerSecond).toBe(1)
  })

  it("does not call the processor during the cooldown and resumes after it", async () => {
    let limited = true
    const { queue, clock, calls } = setup(async () =>
      limited ? { kind: "deferred", cause: "rate-limited" } : entered,
    )
    queue.enqueue(item("c1"), "unavailable")
    await queue.onAlarm()
    expect(calls).toHaveLength(1)
    limited = false

    clock.advance(config.queueCooldownSeconds * 1000 - 1)
    await queue.onAlarm()
    expect(calls).toHaveLength(1)

    clock.advance(1)
    await queue.onAlarm()
    expect(calls).toHaveLength(2)
    expect(queue.stats().queued).toBe(0)
  })

  it("keeps the rate when the token endpoint is unavailable", async () => {
    const { queue } = setup(async () => ({ kind: "deferred", cause: "unavailable" }))
    queue.enqueue(item("c1"), "unavailable")

    await queue.onAlarm()

    expect(queue.stats()).toMatchObject({ ratePerSecond: 4, cooldownUntil: 0, queued: 1 })
  })

  it("lets one failing code leave the rest of the pass alone and logs no code", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { queue, clock } = setup(async (queued) => {
      if (queued.code === "bad") throw new TypeError("secret detail")
      return entered
    })
    const bad = queue.enqueue(item("bad", "g3"), "unavailable")
    clock.advance(1)
    const good = queue.enqueue(item("good"), "unavailable")

    await queue.onAlarm()

    expect(queue.poll(bad.ticket)).toEqual({ kind: "waiting" })
    expect(queue.poll(good.ticket)).toMatchObject({ kind: "done" })
    expect(error).toHaveBeenCalledWith("queue item failed", {
      giveawayId: "g3",
      errorClass: "TypeError",
    })
    expect(JSON.stringify(error.mock.calls)).not.toContain("bad")
    error.mockRestore()
  })
})

describe("TokenQueue cooldown", () => {
  it("starts when a code is queued because of a 429 and reports when it ends", () => {
    const { queue, clock } = setup()

    const first = queue.enqueue(item("c1"), "rate-limited")

    expect(first.cooldownUntil).toBe(clock.now() + config.queueCooldownSeconds * 1000)
  })

  it("is not extended by a later 429 while it runs", () => {
    const { queue, clock } = setup()
    const first = queue.enqueue(item("c1"), "rate-limited")
    clock.advance(10_000)

    const second = queue.enqueue(item("c2"), "rate-limited")

    expect(second.cooldownUntil).toBe(first.cooldownUntil)
  })

  it("is not started by a code queued during it or for a 5xx", () => {
    const { queue } = setup()

    expect(queue.enqueue(item("c1"), "cooldown").cooldownUntil).toBe(0)
    expect(queue.enqueue(item("c2"), "unavailable").cooldownUntil).toBe(0)
  })

  it("starts again after it ended", () => {
    const { queue, clock } = setup()
    queue.enqueue(item("c1"), "rate-limited")
    clock.advance(config.queueCooldownSeconds * 1000)

    const next = queue.enqueue(item("c2"), "rate-limited")

    expect(next.cooldownUntil).toBe(clock.now() + config.queueCooldownSeconds * 1000)
  })
})

describe("TokenQueue alarm", () => {
  it("wakes one second after a code is queued", () => {
    const { queue, alarm, clock } = setup()

    queue.enqueue(item("c1"), "unavailable")

    expect(alarm.at).toBe(clock.now() + 1000)
  })

  it("clears when the last code was dropped for its age", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { queue, alarm, clock } = setup()
    queue.enqueue(item("c1"), "unavailable")
    clock.advance(config.queueCodeMaxAgeSeconds * 1000 + 1)

    await queue.onAlarm()

    expect(alarm.at).toBe(null)
    warn.mockRestore()
  })

  it("waits for the end of the cooldown when it is later than the next pass", () => {
    const { queue, alarm, clock } = setup()

    queue.enqueue(item("c1"), "rate-limited")

    expect(alarm.at).toBe(clock.now() + config.queueCooldownSeconds * 1000)
  })

  it("wakes to delete an unpolled result when it ages out", async () => {
    const { queue, alarm, clock } = setup()
    queue.enqueue(item("c1"), "unavailable")
    const receivedAt = clock.now()

    await queue.onAlarm()

    expect(alarm.at).toBe(receivedAt + config.queueCodeMaxAgeSeconds * 1000 + 1)
  })
})

describe("token queue queries", () => {
  const cases: readonly [string, string, readonly (string | number)[]][] = [
    ["the next queued codes", nextQueuedSql, [4]],
    ["the oldest queued row", oldestQueuedSql, []],
    ["the oldest finished result", oldestDoneSql, []],
    ["the expired codes", expiredQueuedSql, [0]],
  ]

  for (const [name, statement, params] of cases) {
    it(`reads ${name} through the state index without a scan or a sort`, () => {
      const { db } = setup()

      const details = explainPlan(db, statement, params)

      expect(details.some((detail) => detail.includes("INDEX token_queue_by_state"))).toBe(true)
      expect(
        details.some((detail) => detail.startsWith("SCAN") || detail.includes("TEMP B-TREE")),
      ).toBe(false)
    })
  }
})
