import type { ResolvedConfig } from "../config.ts"
import type { AsyncSql, Instant } from "../ports.ts"
import { hourMs } from "../stats/time.ts"

/**
 * The units Google charges per call (YouTube Data API quota calculator): a list of channels or live
 * broadcasts costs 1, a page of live chat messages 5. The OAuth endpoints cost none.
 */
export const youtubeUnits = {
  channels: 1,
  liveBroadcasts: 1,
  liveChatMessages: 5,
} as const

export type YouTubeQuotaConfig = Pick<
  ResolvedConfig,
  | "youtubeDailyQuotaUnits"
  | "youtubeQuotaAlertPercent"
  | "youtubeChatPollMinMs"
  | "youtubeWinnerPollMinMs"
>

/** Today's YouTube units against the install's daily cap, as the admin page and the create form read them. */
export interface YouTubeQuotaUse {
  readonly used: number
  readonly limit: number
  /** Today's use has reached YOUTUBE_QUOTA_ALERT_PERCENT of the cap. */
  readonly alert: boolean
}

/** A stored row that does not have the shape the quota table gives it. */
export class YouTubeQuotaRowError extends Error {
  constructor() {
    super("youtube quota row has an unexpected shape")
  }
}

/**
 * The YouTube units the install spent per day of Google's quota, in the accounts store. Every YouTube API
 * call spends before it is sent, so a call over the cap is never sent.
 */
export class YouTubeQuota {
  constructor(
    private readonly sql: AsyncSql,
    private readonly config: YouTubeQuotaConfig,
  ) {}

  /**
   * Adds `units` to today's count, unless that would pass the cap: false then, and nothing is added. One
   * statement, so two rooms spending at once never pass the cap together.
   */
  async spend(units: number, now: Instant): Promise<boolean> {
    const cap = this.config.youtubeDailyQuotaUnits
    const rows = await this.sql.all(
      `INSERT INTO youtube_quota_days (day, units) SELECT ?, ? WHERE ? <= ?
        ON CONFLICT (day) DO UPDATE SET units = units + excluded.units WHERE units + excluded.units <= ?
        RETURNING units`,
      [quotaDay(now), units, units, cap, cap],
    )
    return rows.length > 0
  }

  async today(now: Instant): Promise<YouTubeQuotaUse> {
    const [row] = await this.sql.all("SELECT units FROM youtube_quota_days WHERE day = ?", [
      quotaDay(now),
    ])
    const used = row === undefined ? 0 : unitsOf(row.units)
    const limit = this.config.youtubeDailyQuotaUnits
    // Whole numbers on both sides, so 6,999 of 10,000 stays below 70 percent.
    return { used, limit, alert: used * 100 >= this.config.youtubeQuotaAlertPercent * limit }
  }

  /** The units a chat watch spends per minute when it reads the entry keyword as often as it may. */
  chatUnitsPerMinute(): number {
    return unitsPerMinute(this.config.youtubeChatPollMinMs)
  }

  /** The same after the draw, while it reads only the winners' claims. */
  winnerUnitsPerMinute(): number {
    return unitsPerMinute(this.config.youtubeWinnerPollMinMs)
  }
}

// Google's quota day starts at midnight Pacific time, daylight saving included.
const pacificDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** The date of Google's quota day an instant falls in, as YYYY-MM-DD. */
export function quotaDay(at: Instant): string {
  const parts = new Map(pacificDate.formatToParts(at).map((part) => [part.type, part.value]))
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`
}

/** The first instant of the quota day after the one `at` falls in. */
export function nextQuotaDayStart(at: Instant): Instant {
  const today = quotaDay(at)
  // Pacific midnight is 07:00 or 08:00 UTC, so the next one lies within 24 hours and is on a whole hour.
  let next = Math.floor(at / hourMs) * hourMs + hourMs
  while (quotaDay(next) === today) next += hourMs
  return next
}

function unitsPerMinute(leastWaitMs: number): number {
  return Math.ceil(60_000 / leastWaitMs) * youtubeUnits.liveChatMessages
}

function unitsOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new YouTubeQuotaRowError()
  return value
}
