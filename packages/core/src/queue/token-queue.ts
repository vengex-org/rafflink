import { errorClass } from "../lib/error-class.ts"
import type { ResolvedConfig } from "../config.ts"
import { randomId } from "../lib/random-id.ts"
import type { PlanLimits } from "../plan/plan-limits.ts"
import type { Alarm, Clock, Instant, Random, Remote, SqlRow, SyncSql } from "../ports.ts"
import type { RoomStub } from "../room/room-directory.ts"
import { queuedEntryTwitchSubrequests } from "../twitch/queued-entry-requests.ts"
import { RowReader } from "../room/rows.ts"
import { startOfMinute } from "../stats/time.ts"
import {
  parseFinalOutcome,
  type DeferCause,
  type EntryAttempt,
  type FinalOutcome,
} from "../viewer/outcome.ts"
import {
  addRateLimitedMinuteSql,
  claimQueuedSql,
  expiredQueuedSql,
  finishClaimedSql,
  oldestClaimSql,
  oldestDoneSql,
  oldestQueuedSql,
  pruneRateLimitedMinutesSql,
  purgeDoneSql,
  rateLimitedMinutesSql,
  releaseStaleSql,
  requeueClaimedSql,
  statsSql,
  waitingCountSql,
} from "./queries.ts"
import { decreasedRate, increasedRate, type DrainRate, type RateConfig } from "./rate-control.ts"

export type QueueConfig = Pick<
  ResolvedConfig,
  | "queueCodeMaxAgeSeconds"
  | "queueProcessingTimeoutSeconds"
  | "queueCooldownSeconds"
  | "queueRateWindowSeconds"
  | "queueBacklogLeaseSeconds"
  | "metricsRetentionHours"
>
  & RateConfig

/** An authorization code waiting for the token endpoint. */
export interface QueuedCode {
  readonly code: string
  readonly giveawayId: string
  readonly nonce: string
}

export interface QueueDeps {
  readonly sql: SyncSql
  readonly alarm: Alarm
  readonly clock: Clock
  readonly random: Random
  readonly config: QueueConfig
  /** The routine the sign-in callback runs; it must not throw for a Twitch answer. */
  readonly process: (item: QueuedCode) => Promise<EntryAttempt>
  /** The rooms whose entries tell the rate a 429 on the direct path interrupted. */
  readonly rooms: { get(giveawayId: string): Pick<RoomStub, "entriesPerSecondBefore"> }
  /**
   * The most codes one alarm invocation processes; a pass with more calls continues in the next invocation
   * right away. See {@link entriesPerInvocation} for a runtime that caps subrequests per invocation, and
   * {@link TokenQueue.useEntriesPerInvocation} to change it while the queue runs.
   */
  readonly entriesPerInvocation: number
}

/** The codes whose Twitch requests fit the subrequests one invocation may send. */
export function entriesPerInvocation(limits: Pick<PlanLimits, "subrequestsPerInvocation">): number {
  return Math.floor(limits.subrequestsPerInvocation / queuedEntryTwitchSubrequests)
}

/**
 * Why a code is queued: `rate-limited` on an idle queue starts the cooldown and measures the rate that hit the
 * limit; `backlog` (queued because the queue still holds codes) and `unavailable` change nothing.
 */
export type EnqueueCause = DeferCause | "backlog"

export interface Enqueued {
  readonly ticket: string
  /**
   * Until when new codes belong in the queue: the end of the cooldown, or a short lease while the codes ahead
   * need more than the next second, whichever is later. In the past when the next second takes them all.
   */
  readonly queueUntil: Instant
}

export type PollOutcome =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "done"
      readonly outcome: FinalOutcome
      /** The verified platform user who entered, for the viewer cookie; null when sign-in failed before that. */
      readonly userId: string | null
    }
  /** No row: the code was dropped or the result aged out. */
  | { readonly kind: "gone" }

export interface QueueStats {
  /** Codes waiting or being processed. */
  readonly queued: number
  readonly ratePerSecond: number
  readonly cooldownUntil: Instant
  /** Codes dropped for age. */
  readonly dropped: number
  /** Results that aged out before the browser read them. */
  readonly abandonedResults: number
  /** Passes whose claim was released and retaken before they reported, so their result was discarded. */
  readonly lostClaims: number
  /** Twitch token endpoint 429s since the queue started, on the direct path and in its own passes. */
  readonly rateLimited: number
  /** When the last 429 came; 0 when none has. */
  readonly lastRateLimitedAt: Instant
  /** The 429s of each minute that had one, from the last METRICS_RETENTION_HOURS, oldest first; `minute` is the start of the minute. */
  readonly rateLimitedMinutes: readonly { readonly minute: Instant; readonly count: number }[]
}

/** The queue methods the HTTP app calls, as an async stub. */
export type TokenQueueStub = Remote<Pick<TokenQueue, "enqueue" | "poll" | "stats">>

/**
 * Authorization codes the token endpoint could not take yet, drained by an alarm in passes of one second.
 * The rate follows AIMD: a 429 cuts it to a share of the calls per second that hit the limit, then it grows
 * by a step per interval until the next 429. Only the first 429 of a backlog also pauses the queue for the
 * cooldown. Its schema is `queueMigrations`.
 */
export class TokenQueue {
  private readonly sql: SyncSql
  private readonly alarm: Alarm
  private readonly clock: Clock
  private readonly random: Random
  private readonly config: QueueConfig
  private readonly process: QueueDeps["process"]
  private readonly rooms: QueueDeps["rooms"]
  private entriesPerInvocation: number

  constructor(deps: QueueDeps) {
    this.sql = deps.sql
    this.alarm = deps.alarm
    this.clock = deps.clock
    this.random = deps.random
    this.config = deps.config
    this.process = deps.process
    this.rooms = deps.rooms
    this.entriesPerInvocation = deps.entriesPerInvocation
    this.sql.exec(
      "INSERT INTO queue_stats (id, rate_per_second) VALUES (1, ?) ON CONFLICT (id) DO NOTHING",
      [this.config.queueMinRatePerSecond],
    )
  }

  /** From the next alarm invocation on, each takes at most `entries` codes; a plan switch calls it. */
  useEntriesPerInvocation(entries: number): void {
    this.entriesPerInvocation = entries
  }

  enqueue(item: QueuedCode, cause: EnqueueCause): Enqueued {
    const now = this.clock.now()
    const ticket = randomId(this.random)
    const ahead = this.sql.transaction(() => {
      if (cause === "rate-limited") this.recordRateLimited(1, now)
      const waiting = this.waitingCount()
      this.sql.exec(
        `INSERT INTO token_queue (ticket, code, giveaway_id, nonce, received_at, state)
         VALUES (?, ?, ?, ?, ?, 'queued')`,
        [ticket, item.code, item.giveawayId, item.nonce, now],
      )
      if (waiting > 0) return waiting
      // A new backlog: the additive steps count from now, not from the end of the previous one.
      this.sql.exec(
        `UPDATE queue_stats SET rate_changed_at = ?, backlog_started_at = ?, pass_started_at = 0,
         pass_calls = 0 WHERE id = 1`,
        [now, now],
      )
      // A 429 on the direct path while the queue is busy says nothing new: the queue's own passes measure it.
      if (cause === "rate-limited" && this.readStats().cooldownUntil <= now) {
        this.sql.exec(
          `UPDATE queue_stats SET cooldown_until = ?, measure_giveaway_id = ?, measure_until = ?
           WHERE id = 1`,
          [now + this.config.queueCooldownSeconds * 1000, item.giveawayId, now],
        )
      }
      return waiting
    })
    this.rearm()
    const stats = this.readStats()
    // At least one invocation per second, each taking at most `entriesPerInvocation` codes.
    const perSecond = Math.min(stats.ratePerSecond, this.entriesPerInvocation)
    if (ahead < perSecond) return { ticket, queueUntil: stats.cooldownUntil }
    // Short, so a rate that grows or an invocation that is faster than one per second ends it soon.
    const seconds = Math.min(Math.ceil(ahead / perSecond), this.config.queueBacklogLeaseSeconds)
    return { ticket, queueUntil: Math.max(stats.cooldownUntil, now + seconds * 1000) }
  }

  /** A finished result stays readable until the sweep removes it, so a lost response can be fetched again. */
  poll(ticket: string): PollOutcome {
    return this.sql.transaction((): PollOutcome => {
      const row = this.sql.exec(
        "SELECT state, result_json, user_id FROM token_queue WHERE ticket = ?",
        [ticket],
      )[0]
      if (row === undefined) return { kind: "gone" }
      const reader = new RowReader("token_queue", row)
      if (reader.oneOf("state", ["queued", "processing", "done"]) !== "done") {
        return { kind: "waiting" }
      }
      const outcome = parseFinalOutcome(reader.text("result_json"))
      if (!outcome.ok) throw new TypeError("token_queue.result_json: unexpected value")
      this.sql.exec("UPDATE token_queue SET polled = 1 WHERE ticket = ?", [ticket])
      return { kind: "done", outcome: outcome.value, userId: reader.nullableText("user_id") }
    })
  }

  stats(): QueueStats {
    const stored = this.readStats()
    return {
      ratePerSecond: stored.ratePerSecond,
      cooldownUntil: stored.cooldownUntil,
      dropped: stored.dropped,
      abandonedResults: stored.abandonedResults,
      lostClaims: stored.lostClaims,
      rateLimited: stored.rateLimited,
      lastRateLimitedAt: stored.lastRateLimitedAt,
      rateLimitedMinutes: this.sql.exec(rateLimitedMinutesSql, []).map((row) => {
        const reader = new RowReader("rate_limited_minute", row)
        return { minute: reader.int("minute"), count: reader.int("count") }
      }),
      queued: this.waitingCount(),
    }
  }

  /** Runs when the alarm fires: drops what aged out, then processes one pass unless a cooldown runs. */
  async onAlarm(): Promise<void> {
    const now = this.clock.now()
    this.sweep(now)
    const stats = this.readStats()
    if (now >= stats.cooldownUntil) await this.drain(now, stats)
    this.rearm()
  }

  private sweep(now: Instant): void {
    const released = this.sql.exec(releaseStaleSql, [
      now - this.config.queueProcessingTimeoutSeconds * 1000,
    ])
    for (const row of released) {
      console.warn("queue claim released", {
        giveawayId: new RowReader("token_queue", row).text("giveaway_id"),
      })
    }
    const cutoff = now - this.config.queueCodeMaxAgeSeconds * 1000
    const expired = this.sql.exec(expiredQueuedSql, [cutoff])
    for (const row of expired) {
      console.warn("queue drop", {
        giveawayId: new RowReader("token_queue", row).text("giveaway_id"),
      })
    }
    this.sql.exec(pruneRateLimitedMinutesSql, [now - this.config.metricsRetentionHours * 3_600_000])
    const purged = this.sql.exec(purgeDoneSql, [cutoff])
    const abandoned = purged.filter((row) => new RowReader("token_queue", row).int("polled") === 0)
    if (expired.length === 0 && abandoned.length === 0) return
    this.sql.exec(
      "UPDATE queue_stats SET dropped = dropped + ?, abandoned_results = abandoned_results + ? WHERE id = 1",
      [expired.length, abandoned.length],
    )
  }

  // One invocation takes at most `entriesPerInvocation` codes of the current pass; `rearm` calls the next one
  // right away while the pass has calls left.
  private async drain(now: Instant, stats: StoredStats): Promise<void> {
    let claimedAt = now
    let pass = { startedAt: stats.passStartedAt, calls: stats.passCalls, rate: stats.ratePerSecond }
    if (now >= stats.passStartedAt + tickMs) {
      // Awaited only to measure: a pass that does not measure claims before its first await.
      let rate = increasedRate(
        this.config,
        { perSecond: stats.ratePerSecond, changedAt: stats.rateChangedAt },
        now,
      )
      if (stats.measure !== null) {
        rate = await this.measuredRate(now, stats.measure)
        claimedAt = this.clock.now()
      }
      this.writeRate(rate)
      pass = { startedAt: claimedAt, calls: 0, rate: rate.perSecond }
    }
    const take = Math.min(pass.rate - pass.calls, this.entriesPerInvocation)
    if (take <= 0) return
    // Claimed before the next await: an invocation that starts while this one waits for Twitch finds nothing to take.
    const items = this.sql.exec(claimQueuedSql, [claimedAt, take]).map(parseQueued)
    const calls = pass.calls + items.length
    this.sql.exec("UPDATE queue_stats SET pass_started_at = ?, pass_calls = ? WHERE id = 1", [
      pass.startedAt,
      calls,
    ])
    if (items.length === 0) return
    const results = await Promise.all(items.map((item) => this.processOne(item, claimedAt)))
    const limited = results.filter((result) => result === "rate-limited").length
    if (limited > 0) {
      this.recordRateLimited(limited, this.clock.now())
      this.slowDown(calls)
    }
  }

  private recordRateLimited(count: number, now: Instant): void {
    this.sql.exec(
      "UPDATE queue_stats SET rate_limited_total = rate_limited_total + ?, last_rate_limited_at = ? WHERE id = 1",
      [count, now],
    )
    this.sql.exec(addRateLimitedMinuteSql, [startOfMinute(now), count])
  }

  // Every invocation of a pass claims within the second the pass started, and each code's token exchange is
  // its first Twitch request, so the pass's calls are the exchanges sent in that second. How long the answers
  // and the Helix reads behind them took says nothing about the rate the token endpoint saw.
  private slowDown(calls: number): void {
    const now = this.clock.now()
    const stats = this.readStats()
    const pausedInBacklog = stats.cooldownUntil > stats.backlogStartedAt
    const cooldownUntil = pausedInBacklog
      ? stats.cooldownUntil
      : now + this.config.queueCooldownSeconds * 1000
    this.writeRate({
      perSecond: decreasedRate(this.config, calls),
      changedAt: Math.max(now, cooldownUntil),
    })
    // The pass ends here: the rest of its second would only meet more 429s.
    this.sql.exec(
      "UPDATE queue_stats SET cooldown_until = ?, pass_calls = rate_per_second WHERE id = 1",
      [cooldownUntil],
    )
  }

  // After a 429 on the direct path the first pass takes what the token endpoint let through just before it.
  private async measuredRate(now: Instant, measure: Measure): Promise<DrainRate> {
    // Cleared before the await, so a pass that starts meanwhile does not measure the same 429 again.
    this.sql.exec(
      "UPDATE queue_stats SET measure_giveaway_id = NULL, measure_until = NULL WHERE id = 1",
      [],
    )
    let trigger = 0
    try {
      trigger = await this.rooms
        .get(measure.giveawayId)
        .entriesPerSecondBefore(measure.until, this.config.queueRateWindowSeconds)
    } catch (error) {
      console.warn("queue trigger rate unavailable", {
        giveawayId: measure.giveawayId,
        errorClass: errorClass(error),
      })
    }
    return { perSecond: decreasedRate(this.config, trigger), changedAt: now }
  }

  private writeRate(rate: DrainRate): void {
    this.sql.exec("UPDATE queue_stats SET rate_per_second = ?, rate_changed_at = ? WHERE id = 1", [
      rate.perSecond,
      rate.changedAt,
    ])
  }

  // One failing item must not stop the rest of the pass: its row goes back to the queue until it ages out.
  // `claimedAt` identifies the claim, so a pass whose claim was released and retaken writes nothing.
  private async processOne(
    item: QueuedItem,
    claimedAt: Instant,
  ): Promise<"done" | DeferCause | "failed"> {
    let attempt: EntryAttempt
    try {
      attempt = await this.process(item)
    } catch (error) {
      console.error("queue item failed", {
        giveawayId: item.giveawayId,
        errorClass: errorClass(error),
      })
      this.requeue(item, claimedAt)
      return "failed"
    }
    if (attempt.kind === "deferred") {
      // A lost claim is logged and counted by `requeue`; the Twitch answer still counts for the rate.
      this.requeue(item, claimedAt)
      return attempt.cause
    }
    const finished = this.sql.exec(finishClaimedSql, [
      JSON.stringify(attempt.outcome),
      attempt.userId,
      item.ticket,
      claimedAt,
    ])
    return this.claimHeld(finished, item, "finish") ? "done" : "failed"
  }

  private requeue(item: QueuedItem, claimedAt: Instant): boolean {
    return this.claimHeld(
      this.sql.exec(requeueClaimedSql, [item.ticket, claimedAt]),
      item,
      "requeue",
    )
  }

  // The statement matches only the claim this pass took; no row means the sweep released it and another pass owns the code now.
  private claimHeld(
    written: readonly SqlRow[],
    item: QueuedItem,
    step: "requeue" | "finish",
  ): boolean {
    if (written.length > 0) return true
    console.warn("queue claim lost", { giveawayId: item.giveawayId, step })
    this.sql.exec("UPDATE queue_stats SET lost_claims = lost_claims + 1 WHERE id = 1", [])
    return false
  }

  private rearm(): void {
    const now = this.clock.now()
    const stats = this.readStats()
    const maxAgeMs = this.config.queueCodeMaxAgeSeconds * 1000
    const wakeups: Instant[] = []
    if (this.sql.exec(oldestQueuedSql, []).length > 0) {
      // The first pass of a backlog comes a second after the code that started it was deferred.
      const passEnd =
        (stats.passStartedAt === 0 ? stats.backlogStartedAt : stats.passStartedAt) + tickMs
      const passOpen =
        stats.passStartedAt !== 0 && stats.passCalls < stats.ratePerSecond && now < passEnd
      wakeups.push(Math.max(passOpen ? now : passEnd, stats.cooldownUntil))
    }
    const oldestClaim = this.sql.exec(oldestClaimSql, [])[0]
    const claimedAt =
      oldestClaim === undefined
        ? null
        : new RowReader("token_queue", oldestClaim).nullableInt("claimed_at")
    if (claimedAt !== null) {
      wakeups.push(claimedAt + this.config.queueProcessingTimeoutSeconds * 1000 + 1)
    }
    const oldestDone = this.sql.exec(oldestDoneSql, [])[0]
    if (oldestDone !== undefined) {
      wakeups.push(new RowReader("token_queue", oldestDone).int("received_at") + maxAgeMs + 1)
    }
    if (wakeups.length === 0) this.alarm.clear()
    else this.alarm.set(Math.min(...wakeups))
  }

  private waitingCount(): number {
    const row = this.sql.exec(waitingCountSql, [])[0]
    return row === undefined ? 0 : new RowReader("token_queue", row).int("c")
  }

  private readStats(): StoredStats {
    const row = this.sql.exec(statsSql, [])[0]
    if (row === undefined) throw new Error("queue is not initialised")
    const reader = new RowReader("queue_stats", row)
    const measureGiveawayId = reader.nullableText("measure_giveaway_id")
    const measureUntil = reader.nullableInt("measure_until")
    return {
      ratePerSecond: reader.int("rate_per_second"),
      rateChangedAt: reader.int("rate_changed_at"),
      cooldownUntil: reader.int("cooldown_until"),
      backlogStartedAt: reader.int("backlog_started_at"),
      passStartedAt: reader.int("pass_started_at"),
      passCalls: reader.int("pass_calls"),
      measure:
        measureGiveawayId === null || measureUntil === null
          ? null
          : { giveawayId: measureGiveawayId, until: measureUntil },
      dropped: reader.int("dropped"),
      abandonedResults: reader.int("abandoned_results"),
      lostClaims: reader.int("lost_claims"),
      rateLimited: reader.int("rate_limited_total"),
      lastRateLimitedAt: reader.int("last_rate_limited_at"),
    }
  }
}

type QueuedItem = QueuedCode & { readonly ticket: string }

type StoredStats = Omit<QueueStats, "queued" | "rateLimitedMinutes"> & {
  readonly rateChangedAt: Instant
  readonly backlogStartedAt: Instant
  readonly passStartedAt: Instant
  /** Codes the current pass has claimed over all its invocations. */
  readonly passCalls: number
  /** The next pass measures the rate of this 429 from the giveaway's room. */
  readonly measure: Measure | null
}

/** A 429 on the direct path: the giveaway of its code and when it came. */
interface Measure {
  readonly giveawayId: string
  readonly until: Instant
}

// The rate is calls per second, so one pass per second.
const tickMs = 1000

function parseQueued(row: SqlRow): QueuedItem {
  const reader = new RowReader("token_queue", row)
  return {
    ticket: reader.text("ticket"),
    code: reader.text("code"),
    giveawayId: reader.text("giveaway_id"),
    nonce: reader.text("nonce"),
  }
}
