import { beforeEach, describe, expect, it } from "bun:test"
import { youtubeWorld, type YouTubeWorld } from "../../test/youtube-fixture.ts"
import { quotaDay } from "./quota.ts"

let world: YouTubeWorld

beforeEach(() => {
  world = youtubeWorld({ YOUTUBE_DAILY_QUOTA_UNITS: "10", YOUTUBE_QUOTA_ALERT_PERCENT: "70" })
})

describe("YouTubeQuota", () => {
  it("adds units up to the cap and refuses a call that would pass it, adding nothing", async () => {
    const now = world.clock.now()

    const spent = [
      await world.quota.spend(5, now),
      await world.quota.spend(5, now),
      await world.quota.spend(1, now),
    ]

    expect(spent).toEqual([true, true, false])
    expect(await world.quota.today(now)).toEqual({ used: 10, limit: 10, alert: true })
  })

  it("refuses a first call of a day that alone passes the cap", async () => {
    expect(await world.quota.spend(11, world.clock.now())).toBe(false)
    expect((await world.quota.today(world.clock.now())).used).toBe(0)
  })

  it("alerts from the alert percent of the cap on, not below it", async () => {
    const now = world.clock.now()
    await world.quota.spend(6, now)
    const below = await world.quota.today(now)
    await world.quota.spend(1, now)

    expect(below.alert).toBe(false)
    expect((await world.quota.today(now)).alert).toBe(true)
  })

  it("starts a new day at midnight Pacific time, standard and daylight saving", async () => {
    // 08:00 UTC is midnight PST in January, 07:00 UTC is midnight PDT in July.
    const beforeWinter = Date.parse("2026-01-15T07:59:59Z")
    const winter = Date.parse("2026-01-15T08:00:00Z")
    const summer = Date.parse("2026-07-15T07:00:00Z")
    await world.quota.spend(10, beforeWinter)

    expect(quotaDay(beforeWinter)).toBe("2026-01-14")
    expect(quotaDay(winter)).toBe("2026-01-15")
    expect(quotaDay(summer - 1)).toBe("2026-07-14")
    expect(quotaDay(summer)).toBe("2026-07-15")
    expect(await world.quota.spend(10, winter)).toBe(true)
  })

  it("estimates the units of a minute of chat reads from the least wait between reads", () => {
    expect(youtubeWorld().quota.chatUnitsPerMinute()).toBe(60)
    expect(youtubeWorld({ YOUTUBE_CHAT_POLL_MIN_MS: "7000" }).quota.chatUnitsPerMinute()).toBe(45)
  })
})
