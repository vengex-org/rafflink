import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { explainPlan, secureRandom, sqlRows, TestAlarm, TestClock } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import { applyMigrations } from "../room/migrate.ts"
import type { EntryAttempt } from "../viewer/outcome.ts"
import { queueMigrations } from "./migrations.ts"
import {
  claimQueuedSql,
  expiredQueuedSql,
  oldestClaimSql,
  oldestDoneSql,
  oldestQueuedSql,
  releaseStaleSql,
  waitingCountSql,
} from "./queries.ts"
import {
  entriesPerInvocation,
  TokenQueue,
  type PollOutcome,
  type QueuedCode,
} from "./token-queue.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
  QUEUE_MIN_RATE_PER_SECOND: "2",
  QUEUE_MAX_RATE_PER_SECOND: "40",
  QUEUE_DECREASE_PERCENT: "50",
  QUEUE_INCREASE_STEP_PER_SECOND: "4",
  QUEUE_INCREASE_INTERVAL_SECONDS: "2",
  QUEUE_RATE_WINDOW_SECONDS: "1",
  QUEUE_COOLDOWN_SECONDS: "3",
  QUEUE_BACKLOG_LEASE_SECONDS: "3",
  QUEUE_CODE_MAX_AGE_SECONDS: "300",
  QUEUE_PROCESSING_TIMEOUT_SECONDS: "60",
})

const entered: EntryAttempt = {
  kind: "final",
  outcome: { kind: "entered", entry: { group: "viewer", tickets: 1, enteredAt: 1 } },
  userId: "1",
}

type Process = (item: QueuedCode) => Promise<EntryAttempt>
/** Entries per second the room of a giveaway wrote before an instant, as the queue asks for them. */
type EntryRate = (giveawayId: string, until: number, windowSeconds: number) => Promise<number>

function setup(
  process: Process = async () => entered,
  entryRate: EntryRate = async () => 0,
  invocationBudget = config.queueMaxRatePerSecond,
) {
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
    rooms: {
      get: (giveawayId) => ({
        entriesPerSecondBefore: (until, windowSeconds) =>
          entryRate(giveawayId, until, windowSeconds),
      }),
    },
    entriesPerInvocation: invocationBudget,
  })
  return { queue, db, clock, alarm, calls }
}

function item(code: string, giveawayId = "g1"): QueuedCode {
  return { code, giveawayId, nonce: `nonce-${code}` }
}

function rowCount(db: Database): number {
  return sqlRows(db, "SELECT ticket FROM token_queue").length
}

/** A token endpoint that answers 429 above `limit` calls per second of `now`. */
function limitedPerSecond(limit: number, now: () => number): Process {
  const callsPerSecond = new Map<number, number>()
  return async () => {
    const second = Math.floor(now() / 1000)
    const count = (callsPerSecond.get(second) ?? 0) + 1
    callsPerSecond.set(second, count)
    return count > limit ? { kind: "deferred", cause: "rate-limited" } : entered
  }
}

afterEach(() => {
  spyOn(console, "warn").mockRestore()
  spyOn(console, "error").mockRestore()
})

describe("TokenQueue results", () => {
  it("keeps a result readable until it ages out, so a lost response can be fetched again", async () => {
    const { queue, db, clock } = setup()
    const { ticket } = queue.enqueue(item("c1"), "unavailable")

    expect(queue.poll(ticket)).toEqual({ kind: "waiting" })
    await queue.onAlarm()

    const done: PollOutcome = { kind: "done", outcome: entered.outcome, userId: "1" }
    expect(queue.poll(ticket)).toEqual(done)
    expect(queue.poll(ticket)).toEqual(done)
    expect(rowCount(db)).toBe(1)

    clock.advance(config.queueCodeMaxAgeSeconds * 1000 + 1)
    await queue.onAlarm()
    expect(queue.poll(ticket)).toEqual({ kind: "gone" })
    expect(queue.stats().abandonedResults).toBe(0)
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

describe("TokenQueue claims", () => {
  it("takes a code once while an earlier pass still waits for Twitch", async () => {
    const release: (() => void)[] = []
    const { queue, calls } = setup(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve(entered))
        }),
    )
    const { ticket } = queue.enqueue(item("c1"), "unavailable")

    const first = queue.onAlarm()
    const second = queue.onAlarm()
    await second

    expect(calls).toHaveLength(1)
    expect(queue.poll(ticket)).toEqual({ kind: "waiting" })
    release[0]?.()
    await first
    expect(queue.poll(ticket)).toMatchObject({ kind: "done" })
  })

  it("returns a claim whose pass never reported to the queue after the processing timeout", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    let hang = true
    const { queue, clock, calls } = setup(() =>
      hang ? new Promise<EntryAttempt>(() => {}) : Promise.resolve(entered),
    )
    const { ticket } = queue.enqueue(item("c1", "g5"), "unavailable")
    void queue.onAlarm()
    hang = false

    clock.advance(config.queueProcessingTimeoutSeconds * 1000)
    await queue.onAlarm()
    expect(calls).toHaveLength(1)

    clock.advance(1)
    await queue.onAlarm()
    expect(calls).toHaveLength(2)
    expect(queue.poll(ticket)).toMatchObject({ kind: "done" })
    expect(warn).toHaveBeenCalledWith("queue claim released", { giveawayId: "g5" })
    warn.mockRestore()
  })

  it("lets a pass whose claim was released write nothing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const finish: ((attempt: EntryAttempt) => void)[] = []
    let first = true
    const { queue, clock } = setup(() => {
      if (!first) return Promise.resolve(entered)
      first = false
      return new Promise<EntryAttempt>((resolve) => finish.push(resolve))
    })
    const { ticket } = queue.enqueue(item("c1"), "unavailable")
    const stale = queue.onAlarm()
    clock.advance(config.queueProcessingTimeoutSeconds * 1000 + 1)
    await queue.onAlarm()

    finish[0]?.({ kind: "final", outcome: { kind: "closed" }, userId: "stale" })
    await stale

    expect(queue.poll(ticket)).toEqual({ kind: "done", outcome: entered.outcome, userId: "1" })
    warn.mockRestore()
  })

  it("logs and counts a pass that lost its claim, without personal data", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const finish: ((attempt: EntryAttempt) => void)[] = []
    let first = true
    const { queue, clock } = setup(() => {
      if (!first) return Promise.resolve(entered)
      first = false
      return new Promise<EntryAttempt>((resolve) => finish.push(resolve))
    })
    queue.enqueue(item("secret-code", "g7"), "unavailable")
    const stale = queue.onAlarm()
    clock.advance(config.queueProcessingTimeoutSeconds * 1000 + 1)
    await queue.onAlarm()

    finish[0]?.({ kind: "final", outcome: { kind: "closed" }, userId: "stale-user" })
    await stale

    expect(warn).toHaveBeenCalledWith("queue claim lost", { giveawayId: "g7", step: "finish" })
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-code|stale-user/)
    expect(queue.stats().lostClaims).toBe(1)
    warn.mockRestore()
  })

  it("counts a deferred pass that lost its claim and still decreases the rate for its 429", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const finish: ((attempt: EntryAttempt) => void)[] = []
    let first = true
    const { queue, clock } = setup(() => {
      if (!first) return Promise.resolve(entered)
      first = false
      return new Promise<EntryAttempt>((resolve) => finish.push(resolve))
    })
    queue.enqueue(item("c1", "g7"), "unavailable")
    const stale = queue.onAlarm()
    clock.advance(config.queueProcessingTimeoutSeconds * 1000 + 1)
    await queue.onAlarm()
    expect(queue.stats()).toMatchObject({ ratePerSecond: 40, cooldownUntil: 0 })

    finish[0]?.({ kind: "deferred", cause: "rate-limited" })
    await stale

    expect(warn).toHaveBeenCalledWith("queue claim lost", { giveawayId: "g7", step: "requeue" })
    expect(queue.stats()).toMatchObject({
      lostClaims: 1,
      ratePerSecond: 2,
      cooldownUntil: clock.now() + config.queueCooldownSeconds * 1000,
    })
    warn.mockRestore()
  })

  it("counts no lost claim for a pass that kept its claim", async () => {
    const { queue } = setup()
    queue.enqueue(item("c1"), "unavailable")

    await queue.onAlarm()

    expect(queue.stats().lostClaims).toBe(0)
  })

  it("drops a released claim that is older than the maximum age", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { queue, db, clock } = setup(() => new Promise<EntryAttempt>(() => {}))
    queue.enqueue(item("c1"), "unavailable")
    void queue.onAlarm()
    clock.advance(config.queueCodeMaxAgeSeconds * 1000 + 1)

    await queue.onAlarm()

    expect(rowCount(db)).toBe(0)
    expect(queue.stats().dropped).toBe(1)
    warn.mockRestore()
  })

  it("wakes when the oldest claim times out", async () => {
    const { queue, alarm, clock } = setup(() => new Promise<EntryAttempt>(() => {}))
    queue.enqueue(item("c1"), "unavailable")
    const claimedAt = clock.now()
    void queue.onAlarm()

    await queue.onAlarm()

    expect(alarm.at).toBe(claimedAt + config.queueProcessingTimeoutSeconds * 1000 + 1)
  })
})

describe("TokenQueue rate", () => {
  it("takes at most the current rate of codes per pass, the oldest ones", async () => {
    const { queue, clock, calls } = setup()
    for (const code of ["c1", "c2", "c3"]) {
      queue.enqueue(item(code), "unavailable")
      clock.advance(1)
    }

    await queue.onAlarm()

    expect(calls.map((call) => call.code).toSorted()).toEqual(["c1", "c2"])
    expect(queue.stats().queued).toBe(1)
  })

  it("after a direct 429 drains at the decreased share of the entries the room wrote just before it", async () => {
    const asked: [string, number, number][] = []
    const { queue, clock, calls } = setup(
      async () => entered,
      async (giveawayId, until, windowSeconds) => {
        asked.push([giveawayId, until, windowSeconds])
        return 20
      },
    )
    const limitedAt = clock.now()
    queue.enqueue(item("c0", "g5"), "rate-limited")
    for (let code = 1; code <= 14; code++) queue.enqueue(item(`c${code}`), "backlog")

    clock.advance(config.queueCooldownSeconds * 1000)
    await queue.onAlarm()

    expect(asked).toEqual([["g5", limitedAt, config.queueRateWindowSeconds]])
    expect(calls).toHaveLength(10)
    expect(queue.stats().ratePerSecond).toBe(10)
  })

  it("asks the room once per 429, not on every pass", async () => {
    let asked = 0
    const { queue, clock } = setup(
      async () => entered,
      async () => {
        asked += 1
        return 20
      },
    )
    queue.enqueue(item("c0"), "rate-limited")
    for (let code = 1; code <= 30; code++) queue.enqueue(item(`c${code}`), "backlog")
    clock.advance(config.queueCooldownSeconds * 1000)

    await queue.onAlarm()
    clock.advance(1000)
    await queue.onAlarm()

    expect(asked).toBe(1)
  })

  it("does not call the processor during the cooldown and resumes after it", async () => {
    const { queue, clock, calls } = setup()
    queue.enqueue(item("c1"), "rate-limited")

    clock.advance(config.queueCooldownSeconds * 1000 - 1)
    await queue.onAlarm()
    expect(calls).toHaveLength(0)

    clock.advance(1)
    await queue.onAlarm()
    expect(calls).toHaveLength(1)
    expect(queue.stats().queued).toBe(0)
  })

  it("grows by one step per interval and cuts the rate at a 429 in a pass without another pause", async () => {
    let queueClock: TestClock | undefined
    const { queue, clock, calls } = setup(
      limitedPerSecond(14, () => queueClock?.now() ?? 0),
      async () => 20,
    )
    queueClock = clock
    queue.enqueue(item("c0"), "rate-limited")
    for (let code = 1; code <= 200; code++) queue.enqueue(item(`c${code}`), "backlog")
    const rates: number[] = []
    const callsPerPass: number[] = []
    clock.advance(config.queueCooldownSeconds * 1000)
    const pausedUntil = queue.stats().cooldownUntil

    for (let n = 0; n < 10; n++) {
      const before = calls.length
      await queue.onAlarm()
      callsPerPass.push(calls.length - before)
      rates.push(queue.stats().ratePerSecond)
      clock.advance(1000)
    }

    // 20 measured -> 10; +4 every 2 s -> 14, 18; 18 calls get 429s -> 9; ... 17 -> 8.
    expect(rates).toEqual([10, 10, 14, 14, 9, 9, 13, 13, 8, 8])
    expect(callsPerPass[5]).toBe(9)
    expect(queue.stats().cooldownUntil).toBe(pausedUntil)
  })

  it("pauses and cuts at the first 429 of a backlog a 5xx started, and only cuts at the next", async () => {
    const { queue, clock } = setup(async () => ({ kind: "deferred", cause: "rate-limited" }))
    for (let code = 1; code <= 40; code++) queue.enqueue(item(`c${code}`), "unavailable")
    clock.advance(10_000)

    // 2 + 5 steps of 4 = 22 calls, all limited: 50 % of 22, and the pause.
    await queue.onAlarm()
    const firstPause = queue.stats().cooldownUntil
    expect(firstPause).toBe(clock.now() + config.queueCooldownSeconds * 1000)
    expect(queue.stats().ratePerSecond).toBe(11)

    // 11 calls, all limited: 50 % of 11, no new pause.
    clock.advance(config.queueCooldownSeconds * 1000)
    await queue.onAlarm()
    expect(queue.stats()).toMatchObject({ ratePerSecond: 5, cooldownUntil: firstPause })
  })

  it("takes the calls of the limited pass as the trigger, not the configured rate", async () => {
    const { queue, clock } = setup(async () => ({ kind: "deferred", cause: "rate-limited" }))
    for (let code = 1; code <= 6; code++) queue.enqueue(item(`c${code}`), "unavailable")
    clock.advance(20_000)

    await queue.onAlarm()

    expect(queue.stats().ratePerSecond).toBe(3)
  })

  it("falls back to the floor and logs when the room cannot tell its rate", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { queue, clock } = setup(
      async () => entered,
      async () => {
        throw new TypeError("room gone")
      },
    )
    queue.enqueue(item("c0", "g9"), "rate-limited")
    clock.advance(config.queueCooldownSeconds * 1000)

    await queue.onAlarm()

    expect(queue.stats().ratePerSecond).toBe(config.queueMinRatePerSecond)
    expect(warn).toHaveBeenCalledWith("queue trigger rate unavailable", {
      giveawayId: "g9",
      errorClass: "TypeError",
    })
    warn.mockRestore()
  })

  it("counts the additive steps from when a backlog starts, not from the last pass", async () => {
    const { queue, clock } = setup()
    queue.enqueue(item("c1"), "unavailable")
    await queue.onAlarm()
    clock.advance(3_600_000)

    for (let code = 2; code <= 20; code++) queue.enqueue(item(`c${code}`), "unavailable")
    await queue.onAlarm()

    expect(queue.stats().ratePerSecond).toBe(config.queueMinRatePerSecond)
  })

  it("keeps the rate when the token endpoint is unavailable", async () => {
    const { queue } = setup(async () => ({ kind: "deferred", cause: "unavailable" }))
    queue.enqueue(item("c1"), "unavailable")

    await queue.onAlarm()

    expect(queue.stats()).toMatchObject({ ratePerSecond: 2, cooldownUntil: 0, queued: 1 })
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

describe("TokenQueue invocations", () => {
  it("fits the Twitch requests of the codes of one invocation into the subrequest budget", () => {
    expect(entriesPerInvocation({ queueSubrequestsPerInvocation: 45 })).toBe(5)
    expect(entriesPerInvocation({ queueSubrequestsPerInvocation: 8 })).toBe(1)
  })

  it("splits a pass over invocations of at most the budget and continues it right away", async () => {
    const { queue, clock, calls, alarm } = setup(
      async () => entered,
      async () => 20,
      3,
    )
    queue.enqueue(item("c0"), "rate-limited")
    for (let code = 1; code <= 30; code++) queue.enqueue(item(`c${code}`), "backlog")
    clock.advance(config.queueCooldownSeconds * 1000)
    const passStart = clock.now()
    const perInvocation: number[] = []

    for (let n = 0; n < 4; n++) {
      const before = calls.length
      await queue.onAlarm()
      perInvocation.push(calls.length - before)
      expect(alarm.at).toBe(n < 3 ? passStart : passStart + 1000)
    }

    // The measured rate is 10 calls per second: 3 + 3 + 3 + 1 in one second.
    expect(perInvocation).toEqual([3, 3, 3, 1])
    await queue.onAlarm()
    expect(calls).toHaveLength(10)
  })

  it("takes every call of the second, over all invocations, as the rate that hit the limit", async () => {
    let queueClock: TestClock | undefined
    const { queue, clock } = setup(
      limitedPerSecond(7, () => queueClock?.now() ?? 0),
      async () => 20,
      3,
    )
    queueClock = clock
    queue.enqueue(item("c0"), "rate-limited")
    for (let code = 1; code <= 30; code++) queue.enqueue(item(`c${code}`), "backlog")
    clock.advance(config.queueCooldownSeconds * 1000)

    for (let n = 0; n < 3; n++) await queue.onAlarm()

    // 9 calls in the second when the third invocation met the limit: 50 % of 9, not of the 3 of that invocation.
    expect(queue.stats().ratePerSecond).toBe(4)
  })

  it("takes the rate the token exchanges were sent at, not how long their answers took", async () => {
    const { queue, clock } = setup(
      async () => {
        clock.advance(1500)
        return { kind: "deferred", cause: "rate-limited" }
      },
      async () => 40,
    )
    queue.enqueue(item("c0"), "rate-limited")
    for (let code = 1; code <= 30; code++) queue.enqueue(item(`c${code}`), "backlog")
    clock.advance(config.queueCooldownSeconds * 1000)

    await queue.onAlarm()

    // 20 exchanges sent at once, answered over 30 s: 50 % of 20.
    expect(queue.stats().ratePerSecond).toBe(10)
  })

  it("claims with the time after the room answered the measurement", async () => {
    const { queue, clock, db } = setup(
      () => new Promise<EntryAttempt>(() => {}),
      async () => {
        clock.advance(700)
        return 20
      },
    )
    queue.enqueue(item("c0"), "rate-limited")
    clock.advance(config.queueCooldownSeconds * 1000)
    const beforeMeasure = clock.now()

    void queue.onAlarm()
    await Bun.sleep(0)

    const claimed = sqlRows(db, "SELECT claimed_at FROM token_queue").map((row) => row.claimed_at)
    expect(claimed).toEqual([beforeMeasure + 700])
  })
})

describe("TokenQueue backlog", () => {
  it("a direct 429 on an idle queue starts the cooldown and reports it as queue-until", () => {
    const { queue, clock } = setup()

    const first = queue.enqueue(item("c1"), "rate-limited")

    expect(first.queueUntil).toBe(clock.now() + config.queueCooldownSeconds * 1000)
    expect(queue.stats().cooldownUntil).toBe(first.queueUntil)
  })

  it("a direct 429 while the queue holds codes changes neither the cooldown nor the rate", async () => {
    let asked = 0
    const { queue } = setup(
      async () => entered,
      async () => {
        asked += 1
        return 30
      },
    )
    queue.enqueue(item("c1"), "unavailable")

    queue.enqueue(item("c2"), "rate-limited")
    await queue.onAlarm()

    expect(queue.stats()).toMatchObject({ cooldownUntil: 0, ratePerSecond: 2 })
    expect(asked).toBe(0)
  })

  it("is not extended by a later 429 while the cooldown runs", () => {
    const { queue, clock } = setup()
    const first = queue.enqueue(item("c1"), "rate-limited")
    clock.advance(1000)

    const second = queue.enqueue(item("c2"), "rate-limited")

    expect(second.queueUntil).toBe(first.queueUntil)
  })

  it("starts no cooldown for a code queued behind a backlog or for a 5xx", () => {
    const { queue } = setup()

    expect(queue.enqueue(item("c1"), "backlog").queueUntil).toBe(0)
    expect(queue.enqueue(item("c2"), "unavailable").queueUntil).toBe(0)
    expect(queue.stats().cooldownUntil).toBe(0)
  })

  it("reports a backlog longer than one pass as queue-until, so new codes join it", () => {
    const { queue, clock } = setup()
    for (let code = 1; code <= 4; code++) queue.enqueue(item(`c${code}`), "unavailable")

    const fifth = queue.enqueue(item("c5"), "unavailable")

    // Four codes ahead at two per pass: two more passes before the queue keeps up.
    expect(fifth.queueUntil).toBe(clock.now() + 2000)
  })

  it("counts the codes one invocation takes when the rate is higher, so new codes do not overtake", () => {
    const { queue, clock } = setup(
      async () => entered,
      async () => 0,
      1,
    )
    queue.enqueue(item("c1"), "unavailable")

    // Rate 2, but one code per invocation: the code ahead needs the next second.
    expect(queue.enqueue(item("c2"), "unavailable").queueUntil).toBe(clock.now() + 1000)
  })

  it("caps the lease, so a slow rate that grows soon stops routing new codes to the queue", () => {
    const { queue, clock } = setup()
    for (let code = 1; code <= 20; code++) queue.enqueue(item(`c${code}`), "unavailable")

    // 20 codes ahead at 2 per second would be 10 s.
    expect(queue.enqueue(item("c21"), "unavailable").queueUntil).toBe(
      clock.now() + config.queueBacklogLeaseSeconds * 1000,
    )
  })

  it("reports no backlog when the next pass takes every queued code", () => {
    const { queue } = setup()
    queue.enqueue(item("c1"), "unavailable")

    expect(queue.enqueue(item("c2"), "unavailable").queueUntil).toBe(0)
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

describe("token queue schema", () => {
  it("upgrades a queue from before the adaptive rate and keeps its counters", () => {
    const db = new Database(":memory:")
    const sql = new BunSqliteSyncSql(db)
    applyMigrations(sql, queueMigrations.slice(0, 1))
    db.exec("INSERT INTO queue_stats (id, rate_per_second, dropped) VALUES (1, 50, 7)")

    applyMigrations(sql, queueMigrations)
    const queue = new TokenQueue({
      sql,
      alarm: new TestAlarm(),
      clock: new TestClock(1_000_000),
      random: secureRandom,
      config,
      process: async () => entered,
      rooms: { get: () => ({ entriesPerSecondBefore: async () => 0 }) },
      entriesPerInvocation: config.queueMaxRatePerSecond,
    })

    expect(queue.enqueue(item("c1"), "rate-limited").queueUntil).toBe(
      1_000_000 + config.queueCooldownSeconds * 1000,
    )
    expect(queue.stats()).toMatchObject({ ratePerSecond: 50, dropped: 7, queued: 1 })
  })
})

describe("token queue upgrade", () => {
  it("starts the additive steps of codes waiting at the upgrade from the upgrade, not from 1970", async () => {
    const db = new Database(":memory:")
    const sql = new BunSqliteSyncSql(db)
    applyMigrations(sql, queueMigrations.slice(0, 1))
    db.exec("INSERT INTO queue_stats (id, rate_per_second) VALUES (1, 20)")
    db.exec(`INSERT INTO token_queue (ticket, code, giveaway_id, nonce, received_at, state)
      VALUES ('t1', 'c1', 'g1', 'n1', ${Date.now()}, 'queued')`)

    applyMigrations(sql, queueMigrations)
    const queue = new TokenQueue({
      sql,
      alarm: new TestAlarm(),
      clock: new TestClock(Date.now() + 1000),
      random: secureRandom,
      config,
      process: async () => entered,
      rooms: { get: () => ({ entriesPerSecondBefore: async () => 0 }) },
      entriesPerInvocation: config.queueMaxRatePerSecond,
    })
    await queue.onAlarm()

    expect(queue.stats().ratePerSecond).toBeLessThan(config.queueMaxRatePerSecond)
  })
})

describe("token queue queries", () => {
  const cases: readonly [string, string, readonly (string | number)[]][] = [
    ["the claim of the next queued codes", claimQueuedSql, [1, 4]],
    ["the stale claims", releaseStaleSql, [0]],
    ["the oldest claim", oldestClaimSql, []],
    ["the oldest queued row", oldestQueuedSql, []],
    ["the oldest finished result", oldestDoneSql, []],
    ["the expired codes", expiredQueuedSql, [0]],
    ["the waiting count", waitingCountSql, []],
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
