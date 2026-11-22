import type { ResolvedConfig } from "../config.ts"
import {
  maxBoundParameters,
  type AsyncSql,
  type Instant,
  type SqlRow,
  type SqlStatement,
} from "../ports.ts"
import { RowReader } from "../room/rows.ts"
import {
  countReferralSql,
  giveawaysPerDaySql,
  minutesSinceSql,
  openGiveawayCountSql,
  openGiveawaysSql,
  pruneMinutesSql,
  pruneReferralsSql,
  returningStreamersSql,
  streamersPerDaySql,
  topReferralsSql,
} from "./queries.ts"
import { dayMs, hourMs } from "./time.ts"

/** The entries and claims of every room in one minute; `minute` is the start of the minute. */
export interface MinuteCounts {
  readonly minute: Instant
  readonly entries: number
  readonly claims: number
}

/** A count on one UTC day; `day` is the start of the day. */
export interface DayCount {
  readonly day: Instant
  readonly count: number
}

/** An open giveaway as the admin page lists it. */
export interface OpenGiveaway {
  readonly id: string
  readonly code: string
  readonly title: string | null
  readonly closesAt: Instant | null
  readonly streamerName: string
}

export interface ReferralCount {
  readonly ref: string
  readonly visits: number
}

export type StatsStoreConfig = Pick<
  ResolvedConfig,
  | "metricsRetentionHours"
  | "referralSourcesPerDayMax"
  | "referralVisitsPerDayMax"
  | "adminStatsDays"
>

const minuteColumns = 3
const minuteRowsPerInsert = Math.floor(maxBoundParameters / minuteColumns)

/**
 * Aggregate counters for the admin page over the account database. Nothing it stores or returns names or
 * identifies a person: counts per minute, per day and per referral label.
 */
export class StatsStore {
  constructor(
    private readonly sql: AsyncSql,
    private readonly config: StatsStoreConfig,
  ) {}

  /** Adds the counts to their minutes and deletes the minutes older than the retention, in one batch. */
  async addMinutes(counts: readonly MinuteCounts[], now: Instant): Promise<void> {
    const statements: SqlStatement[] = []
    for (let from = 0; from < counts.length; from += minuteRowsPerInsert) {
      const chunk = counts.slice(from, from + minuteRowsPerInsert)
      statements.push({
        sql: `INSERT INTO metrics_minute (minute, entries, claims) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}
          ON CONFLICT (minute) DO UPDATE SET entries = entries + excluded.entries, claims = claims + excluded.claims`,
        params: chunk.flatMap((row) => [row.minute, row.entries, row.claims]),
      })
    }
    statements.push({
      sql: pruneMinutesSql,
      params: [now - this.config.metricsRetentionHours * hourMs],
    })
    await this.sql.batch(statements)
  }

  /** Minutes from `since` on that have a row, oldest first. */
  async minutes(since: Instant): Promise<MinuteCounts[]> {
    const rows = await this.sql.all(minutesSinceSql, [since])
    return rows.map((row) => {
      const reader = new RowReader("metrics_minute", row)
      return {
        minute: reader.int("minute"),
        entries: reader.int("entries"),
        claims: reader.int("claims"),
      }
    })
  }

  /**
   * Counts one visit of a source today and deletes the days past `ADMIN_STATS_DAYS`. `skipped`: the day
   * already holds the most sources or the most visits it may, and nothing was written for the count.
   */
  async countReferral(ref: string, now: Instant): Promise<"counted" | "skipped"> {
    const day = Math.floor(now / dayMs)
    const written = await this.sql.all(countReferralSql, [
      day,
      ref,
      day,
      ref,
      day,
      this.config.referralSourcesPerDayMax,
      day,
      this.config.referralVisitsPerDayMax,
    ])
    await this.sql.run(pruneReferralsSql, [day - this.config.adminStatsDays])
    return written.length === 1 ? "counted" : "skipped"
  }

  /** The busiest sources from `since` on, as visits summed over the days. */
  async topReferrals(since: Instant, limit: number): Promise<ReferralCount[]> {
    const rows = await this.sql.all(topReferralsSql, [Math.floor(since / dayMs), limit])
    return rows.map((row) => {
      const reader = new RowReader("referrals", row)
      return { ref: reader.text("ref"), visits: reader.int("visits") }
    })
  }

  /** Giveaways created per day from `since` on; a day with none has no entry. */
  async giveawaysPerDay(since: Instant): Promise<DayCount[]> {
    return this.perDay(giveawaysPerDaySql, since)
  }

  /** Streamers who signed in for the first time, per day from `since` on; a day with none has no entry. */
  async streamersPerDay(since: Instant): Promise<DayCount[]> {
    return this.perDay(streamersPerDaySql, since)
  }

  /** Streamers whose second giveaway came within `withinMs` of their first. */
  async returningStreamers(withinMs: number): Promise<number> {
    const [row] = await this.sql.all(returningStreamersSql, [withinMs])
    return count(row)
  }

  /** The newest open giveaways, at most `limit`, and how many are open in all. */
  async openGiveaways(limit: number): Promise<{ total: number; giveaways: OpenGiveaway[] }> {
    const [rows, total] = await Promise.all([
      this.sql.all(openGiveawaysSql, [limit]),
      this.sql.all(openGiveawayCountSql, []),
    ])
    return {
      total: count(total[0]),
      giveaways: rows.map((row) => {
        const reader = new RowReader("giveaways", row)
        return {
          id: reader.text("id"),
          code: reader.text("code"),
          title: reader.nullableText("title"),
          closesAt: reader.nullableInt("closes_at"),
          streamerName: reader.text("streamer_name"),
        }
      }),
    }
  }

  private async perDay(sql: string, since: Instant): Promise<DayCount[]> {
    const rows = await this.sql.all(sql, [since])
    return rows.map((row) => {
      const reader = new RowReader("stats", row)
      return { day: reader.int("day") * dayMs, count: reader.int("c") }
    })
  }
}

function count(row: SqlRow | undefined): number {
  return row === undefined ? 0 : new RowReader("stats", row).int("c")
}
