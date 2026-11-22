import type { Instant } from "../ports.ts"
import type { DayCount, MinuteCounts } from "./stats-store.ts"
import { dayMs, minuteMs, startOfDay, startOfMinute } from "./time.ts"

/** One minute of the chart: what the rooms counted and the 429s of the token endpoint. */
export interface SeriesMinute extends MinuteCounts {
  readonly rateLimited: number
}

/** The `minutes` minutes ending with the one `now` falls in, oldest first; a minute nobody counted is zero. */
export function denseMinutes(
  rooms: readonly MinuteCounts[],
  rateLimited: ReadonlyMap<Instant, number>,
  now: Instant,
  minutes: number,
): SeriesMinute[] {
  const last = startOfMinute(now)
  const byMinute = new Map(rooms.map((row) => [row.minute, row]))
  return Array.from({ length: minutes }, (_, index) => {
    const minute = last - (minutes - 1 - index) * minuteMs
    const row = byMinute.get(minute)
    return {
      minute,
      entries: row?.entries ?? 0,
      claims: row?.claims ?? 0,
      rateLimited: rateLimited.get(minute) ?? 0,
    }
  })
}

/** One day of the growth chart. */
export interface GrowthDay {
  readonly day: Instant
  readonly giveaways: number
  readonly streamers: number
}

/** The `days` days ending with the one `now` falls in, oldest first; a day without a row is zero. */
export function denseDays(
  giveaways: readonly DayCount[],
  streamers: readonly DayCount[],
  now: Instant,
  days: number,
): GrowthDay[] {
  const last = startOfDay(now)
  const giveawaysByDay = new Map(giveaways.map((row) => [row.day, row.count]))
  const streamersByDay = new Map(streamers.map((row) => [row.day, row.count]))
  return Array.from({ length: days }, (_, index) => {
    const day = last - (days - 1 - index) * dayMs
    return {
      day,
      giveaways: giveawaysByDay.get(day) ?? 0,
      streamers: streamersByDay.get(day) ?? 0,
    }
  })
}
