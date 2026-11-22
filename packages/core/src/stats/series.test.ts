import { describe, expect, it } from "bun:test"
import { denseDays, denseMinutes } from "./series.ts"
import { dayMs, minuteMs } from "./time.ts"

describe("denseMinutes", () => {
  it("returns one point per minute ending with the minute of now, zero where nobody counted", () => {
    const now = 10 * minuteMs + 30_000

    const series = denseMinutes(
      [{ minute: 9 * minuteMs, entries: 4, claims: 1 }],
      new Map([[10 * minuteMs, 2]]),
      now,
      3,
    )

    expect(series).toEqual([
      { minute: 8 * minuteMs, entries: 0, claims: 0, rateLimited: 0 },
      { minute: 9 * minuteMs, entries: 4, claims: 1, rateLimited: 0 },
      { minute: 10 * minuteMs, entries: 0, claims: 0, rateLimited: 2 },
    ])
  })

  it("leaves out minutes outside the window", () => {
    const series = denseMinutes(
      [{ minute: 0, entries: 5, claims: 5 }],
      new Map([[0, 5]]),
      10 * minuteMs,
      2,
    )

    expect(series.map((point) => point.entries + point.claims + point.rateLimited)).toEqual([0, 0])
  })
})

describe("denseDays", () => {
  it("returns one point per UTC day ending with the day of now, zero where nothing was created", () => {
    const now = 10 * dayMs + 5 * 3_600_000

    const growth = denseDays(
      [{ day: 9 * dayMs, count: 3 }],
      [
        { day: 8 * dayMs, count: 1 },
        { day: 10 * dayMs, count: 2 },
      ],
      now,
      3,
    )

    expect(growth).toEqual([
      { day: 8 * dayMs, giveaways: 0, streamers: 1 },
      { day: 9 * dayMs, giveaways: 3, streamers: 0 },
      { day: 10 * dayMs, giveaways: 0, streamers: 2 },
    ])
  })
})
