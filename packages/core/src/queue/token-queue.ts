import { errorClass } from "../lib/error-class.ts"
import type { ResolvedConfig } from "../config.ts"
import { randomId } from "../lib/random-id.ts"
import type { Alarm, Clock, Instant, Random, Remote, SqlRow, SyncSql } from "../ports.ts"
import { RowReader } from "../room/rows.ts"
import {
  parseFinalOutcome,
  type DeferCause,
  type EntryAttempt,
  type FinalOutcome,
} from "../viewer/outcome.ts"
import {
  claimQueuedSql,
  expiredQueuedSql,
  finishClaimedSql,
  oldestClaimSql,
  oldestDoneSql,
  oldestQueuedSql,
  purgeDoneSql,
  releaseStaleSql,
  requeueClaimedSql,
  statsSql,
} from "./queries.ts"

export type QueueConfig = Pick<
  ResolvedConfig,
  | "queueCodeMaxAgeSeconds"
  | "queueProcessingTimeoutSeconds"
  | "queueCooldownSeconds"
  | "queueStartRatePerSecond"
  | "queueMinRatePerSecond"
  | "queueMaxRatePerSecond"
>

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
}

/** Why a code is queued: `rate-limited` starts the cooldown, the others change nothing. */
export type EnqueueCause = DeferCause | "cooldown"

export interface Enqueued {
  readonly ticket: string
  /** Until when new codes belong in the queue; 0 when no cooldown runs. */
  readonly cooldownUntil: Instant
}

export type PollOutcome =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "done"
      readonly outcome: FinalOutcome
      /** The verified platform user who entered, for the viewer cookie; null when sign-in failed before that. */
      readonly userId: string | null
    }
  /** No row: the code was dropped, or the result was already read. */
  | { readonly kind: "gone" }

export interface QueueStats {
  readonly queued: number
  readonly ratePerSecond: number
  readonly cooldownUntil: Instant
  /** Codes dropped for age. */
  readonly dropped: number
  /** Results that aged out before the browser read them. */
  readonly abandonedResults: number
}

/** The queue methods the HTTP app calls, as an async stub. */
export type TokenQueueStub = Remote<Pick<TokenQueue, "enqueue" | "poll" | "stats">>

/**
 * Authorization codes the token endpoint could not take yet, drained by an alarm at a rate that halves
 * after a 429 and doubles after a clean pass. Its schema is `queueMigrations`.
 */
export class TokenQueue {
  private readonly sql: SyncSql
  private readonly alarm: Alarm
  private readonly clock: Clock
  private readonly random: Random
  private readonly config: QueueConfig
  private readonly process: QueueDeps["process"]

  constructor(deps: QueueDeps) {
    this.sql = deps.sql
    this.alarm = deps.alarm
    this.clock = deps.clock
    this.random = deps.random
    this.config = deps.config
    this.process = deps.process
    this.sql.exec(
      "INSERT INTO queue_stats (id, rate_per_second) VALUES (1, ?) ON CONFLICT (id) DO NOTHING",
      [this.config.queueStartRatePerSecond],
    )
  }

  enqueue(item: QueuedCode, cause: EnqueueCause): Enqueued {
    const now = this.clock.now()
    const ticket = randomId(this.random)
    this.sql.transaction(() => {
      this.sql.exec(
        `INSERT INTO token_queue (ticket, code, giveaway_id, nonce, received_at, state)
         VALUES (?, ?, ?, ?, ?, 'queued')`,
        [ticket, item.code, item.giveawayId, item.nonce, now],
      )
      if (cause === "rate-limited" && this.readStats().cooldownUntil <= now) {
        this.sql.exec("UPDATE queue_stats SET cooldown_until = ? WHERE id = 1", [
          now + this.config.queueCooldownSeconds * 1000,
        ])
      }
    })
    this.rearm()
    return { ticket, cooldownUntil: this.readStats().cooldownUntil }
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
    const stats = this.readStats()
    const queued = this.sql.exec(
      "SELECT COUNT(*) AS c FROM token_queue WHERE state IN ('queued', 'processing')",
      [],
    )[0]
    return {
      ...stats,
      queued: queued === undefined ? 0 : new RowReader("token_queue", queued).int("c"),
    }
  }

  /** Runs when the alarm fires: drops what aged out, then processes one pass unless a cooldown runs. */
  async onAlarm(): Promise<void> {
    const now = this.clock.now()
    this.sweep(now)
    const stats = this.readStats()
    if (now >= stats.cooldownUntil) await this.drain(now, stats.ratePerSecond)
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
    const purged = this.sql.exec(purgeDoneSql, [cutoff])
    const abandoned = purged.filter((row) => new RowReader("token_queue", row).int("polled") === 0)
    if (expired.length === 0 && abandoned.length === 0) return
    this.sql.exec(
      "UPDATE queue_stats SET dropped = dropped + ?, abandoned_results = abandoned_results + ? WHERE id = 1",
      [expired.length, abandoned.length],
    )
  }

  private async drain(now: Instant, rate: number): Promise<void> {
    // Claimed before the first await: a pass that starts while this one waits for Twitch finds nothing to take.
    const items = this.sql.exec(claimQueuedSql, [now, rate]).map(parseQueued)
    if (items.length === 0) return
    const results = await Promise.all(items.map((item) => this.processOne(item, now)))
    const limited = results.includes("rate-limited")
    const allDone = results.every((result) => result === "done")
    if (limited) {
      this.sql.exec("UPDATE queue_stats SET rate_per_second = ?, cooldown_until = ? WHERE id = 1", [
        Math.max(this.config.queueMinRatePerSecond, Math.floor(rate / 2)),
        now + this.config.queueCooldownSeconds * 1000,
      ])
    } else if (allDone) {
      this.sql.exec("UPDATE queue_stats SET rate_per_second = ? WHERE id = 1", [
        Math.min(this.config.queueMaxRatePerSecond, rate * 2),
      ])
    }
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
      this.sql.exec(requeueClaimedSql, [item.ticket, claimedAt])
      return "failed"
    }
    if (attempt.kind === "deferred") {
      this.sql.exec(requeueClaimedSql, [item.ticket, claimedAt])
      return attempt.cause
    }
    this.sql.exec(finishClaimedSql, [
      JSON.stringify(attempt.outcome),
      attempt.userId,
      item.ticket,
      claimedAt,
    ])
    return "done"
  }

  private rearm(): void {
    const now = this.clock.now()
    const stats = this.readStats()
    const maxAgeMs = this.config.queueCodeMaxAgeSeconds * 1000
    const wakeups: Instant[] = []
    if (this.sql.exec(oldestQueuedSql, []).length > 0) {
      wakeups.push(Math.max(now + tickMs, stats.cooldownUntil))
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

  private readStats(): Omit<QueueStats, "queued"> {
    const row = this.sql.exec(statsSql, [])[0]
    if (row === undefined) throw new Error("queue is not initialised")
    const reader = new RowReader("queue_stats", row)
    return {
      ratePerSecond: reader.int("rate_per_second"),
      cooldownUntil: reader.int("cooldown_until"),
      dropped: reader.int("dropped"),
      abandonedResults: reader.int("abandoned_results"),
    }
  }
}

type QueuedItem = QueuedCode & { readonly ticket: string }

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
