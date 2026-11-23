import { afterEach, describe, expect, it, spyOn } from "bun:test"
import {
  Browser,
  fullStreamerStart,
  createGiveaway,
  createHarness,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import { dayMs, minuteMs, startOfDay, startOfMinute } from "../stats/time.ts"
import type { AdminStatsJson } from "./json.ts"

let harness: Harness | null = null

const requiredEnv = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
}

afterEach(async () => {
  await harness?.stop()
  harness = null
})

async function start(env: Record<string, string> = {}): Promise<Harness> {
  harness = await createHarness({ env })
  return harness
}

async function adminBrowser(running: Harness): Promise<Browser> {
  const browser = new Browser(running)
  await browser.signInAs(users.streamerA.id, fullStreamerStart)
  return browser
}

async function stats(browser: Browser): Promise<AdminStatsJson> {
  const response = await browser.request("/api/admin/stats")
  expect(response.status).toBe(200)
  return response.json()
}

describe("GET /api/admin/stats", () => {
  it("answers 401 without a session and 403 to a streamer who is not an admin", async () => {
    const running = await start()
    const other = new Browser(running)
    await other.signInAs(users.streamerB.id, fullStreamerStart)

    expect((await new Browser(running).request("/api/admin/stats")).status).toBe(401)
    expect((await other.request("/api/admin/stats")).status).toBe(403)
  })

  it("lists the open giveaways with the counts of their rooms, and the day's growth", async () => {
    const running = await start()
    const created = await createGiveaway(running)
    running.rooms.roomFor(created.id)
    await running.deps.rooms.get(created.id).enter(
      {
        platformUserId: users.viewer.id,
        login: users.viewer.login,
        displayName: users.viewer.displayName,
        profileImageUrl: null,
        isFollower: false,
        subTier: null,
        accountAgeDays: 100,
      },
      { blockListVersion: 0 },
    )

    const body = await stats(created.browser)

    expect(body.openGiveaways).toBe(1)
    expect(body.giveaways).toEqual([
      {
        code: created.code,
        title: "Giveaway",
        streamerName: users.streamerA.displayName,
        closesAt: null,
        counts: { entrants: 1, entriesLastMinute: 1, claimsLastMinute: 0, viewers: 0 },
      },
    ])
    expect([body.viewers, body.entriesLastMinute, body.claimsLastMinute]).toEqual([0, 1, 0])
    expect(body.growth).toHaveLength(14)
    expect(body.growth.at(-1)).toEqual({
      day: startOfDay(running.clock.now()),
      giveaways: 1,
      streamers: 1,
    })
    expect(body.returningStreamers).toBe(0)
    expect(body.queue).toMatchObject({ queued: 0, rateLimited: 0, rateLimitedMinutes: [] })
  })

  it("shows no access counts while signup is open", async () => {
    const running = await start()

    expect((await stats(await adminBrowser(running))).access).toBeNull()
  })

  it("counts the streamers waiting for approval and the approved ones with signup closed, admins left out", async () => {
    const running = await start({ OPEN_SIGNUP: "false" })
    const admin = await adminBrowser(running)
    const waiting = new Browser(running)
    await waiting.signInAs(users.streamerB.id, fullStreamerStart)

    expect((await stats(admin)).access).toEqual({ pending: 1, approved: 0, truncated: false })
  })

  it("returns one point per minute of the window, with the room minutes and the 429 minutes", async () => {
    const running = await start({ ADMIN_STATS_SERIES_MINUTES: "3" })
    const admin = await adminBrowser(running)
    const minute = startOfMinute(running.clock.now()) - minuteMs
    await running.deps.stats.addMinutes([{ minute, entries: 4, claims: 1 }], running.clock.now())
    running.queue.enqueue(
      { code: "c", giveawayId: "g", nonce: "n", codeVerifier: "v" },
      "rate-limited",
    )

    const body = await stats(admin)

    expect(body.series).toEqual([
      { minute: minute - minuteMs, entries: 0, claims: 0, rateLimited: 0 },
      { minute, entries: 4, claims: 1, rateLimited: 0 },
      { minute: minute + minuteMs, entries: 0, claims: 0, rateLimited: 1 },
    ])
  })

  it("lists the busiest referral sources of the window", async () => {
    const running = await start()
    const admin = await adminBrowser(running)
    await running.deps.stats.countReferral("reddit", running.clock.now())
    await running.deps.stats.countReferral("reddit", running.clock.now())
    await running.deps.stats.countReferral("blog", running.clock.now())

    expect((await stats(admin)).referrals).toEqual([
      { ref: "reddit", visits: 2 },
      { ref: "blog", visits: 1 },
    ])
  })

  it("passes on the usage of the day", async () => {
    const running = await start()
    const admin = await adminBrowser(running)
    running.usage.usage = { workerRequests: 70_000, doRequests: 5 }

    expect((await stats(admin)).usage).toMatchObject({ workerRequests: { used: 70_000 } })
  })

  it("counts the pages open on the site per kind, without the ones that closed", async () => {
    const running = await start()
    const admin = await adminBrowser(running)
    running.presence.join("home")
    running.presence.join("giveaway")
    const leave = running.presence.join("legal")
    leave()

    expect((await stats(admin)).presence).toEqual({
      total: 2,
      byKind: { home: 1, legal: 0, dashboard: 0, giveaway: 1, other: 0 },
    })
  })

  it("shows the presence as unavailable when its count does not answer, and the rest of the numbers", async () => {
    const running = await start()
    const admin = await adminBrowser(running)
    const counts = spyOn(running.presence, "counts").mockRejectedValue(new Error("down"))
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    const answer = await stats(admin)

    expect(answer.presence).toBe("unavailable")
    expect(answer.openGiveaways).toBe(0)
    expect(warn).toHaveBeenCalledWith("presence unavailable", { errorClass: "Error" })
    counts.mockRestore()
    warn.mockRestore()
  })

  it("shows the presence as unavailable without a warning where the target has no presence count", async () => {
    harness = await createHarness({ withoutPresence: true })
    const admin = await adminBrowser(harness)
    const warn = spyOn(console, "warn")

    expect((await stats(admin)).presence).toBe("unavailable")
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // A Worker invocation on the Free plan may make 50 subrequests: every D1 query, Durable Object call, cache
  // call and fetch counts. The most a request makes is its own subrequests plus one per room it asks.
  it("stays within 50 subrequests with signup closed and the most rooms ADMIN_STATS_LIVE_ROOMS_MAX allows", async () => {
    const mostRooms = 30
    expect(() => resolveConfig({ ...requiredEnv, ADMIN_STATS_LIVE_ROOMS_MAX: "31" })).toThrow()
    const running = await start({ OPEN_SIGNUP: "false", ADMIN_STATS_CACHE_SECONDS: "0" })
    const admin = await adminBrowser(running)
    const calls = [
      spyOn(BunSqliteAsyncSql.prototype, "all"),
      spyOn(BunSqliteAsyncSql.prototype, "run"),
      spyOn(BunSqliteAsyncSql.prototype, "batch"),
      spyOn(running.deps.queue, "stats"),
      spyOn(running.presence, "counts"),
      spyOn(running.usage, "today"),
      spyOn(running.deps.publicCache, "read"),
      spyOn(running.deps.publicCache, "write"),
    ]

    await stats(admin)
    const own = calls.reduce((sum, spy) => sum + spy.mock.calls.length, 0)

    expect(own).toBeGreaterThan(0)
    expect(own + mostRooms).toBeLessThanOrEqual(50)
    for (const spy of calls) spy.mockRestore()
  })

  it("asks the rooms of the newest giveaways only, up to ADMIN_STATS_LIVE_ROOMS_MAX", async () => {
    const running = await start({ ADMIN_STATS_LIVE_ROOMS_MAX: "1" })
    const first = await createGiveaway(running)
    running.clock.advance(1000)
    const second = await createGiveaway(running)

    const body = await stats(second.browser)

    expect(body.openGiveaways).toBe(2)
    expect(body.giveaways.map((giveaway) => giveaway.code)).toEqual([second.code])
    expect(body.giveaways.map((giveaway) => giveaway.code)).not.toContain(first.code)
  })

  it("shows a giveaway whose room does not answer with null counts and keeps the others", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const running = await start()
    const healthy = await createGiveaway(running)
    running.clock.advance(1000)
    const owner = await running.deps.accounts.findGiveawayByCode(healthy.code)
    await running.deps.accounts.insertGiveaway({
      id: "0".repeat(32),
      code: "ZZZZZ",
      streamerId: owner?.streamerId ?? "",
      title: "No room",
      prize: null,
      rules: validRules,
      closesAt: null,
      claimSeconds: 300,
      winnerCount: 1,
      overlayToken: "overlay",
      createdAt: running.clock.now(),
    })

    const body = await stats(healthy.browser)

    expect(body.giveaways.map((giveaway) => [giveaway.code, giveaway.counts === null])).toEqual([
      ["ZZZZZ", true],
      [healthy.code, false],
    ])
    expect(warn).toHaveBeenCalledWith("room counts unavailable", {
      giveawayId: "0".repeat(32),
      errorClass: "Error",
    })
    warn.mockRestore()
  })

  it("reuses the answer for ADMIN_STATS_CACHE_SECONDS and reads again after it", async () => {
    const running = await start()
    const created = await createGiveaway(running)
    expect((await stats(created.browser)).openGiveaways).toBe(1)
    await createGiveaway(running)

    expect((await stats(created.browser)).openGiveaways).toBe(1)

    running.clock.advance(5000)
    expect((await stats(created.browser)).openGiveaways).toBe(2)
  })

  it("reads again at once for a request with fresh=1 and keeps the copy for the others", async () => {
    const running = await start()
    const created = await createGiveaway(running)
    expect((await stats(created.browser)).openGiveaways).toBe(1)
    await createGiveaway(running)

    const fresh: AdminStatsJson = await (
      await created.browser.request("/api/admin/stats?fresh=1")
    ).json()

    expect(fresh.openGiveaways).toBe(2)
    expect((await stats(created.browser)).openGiveaways).toBe(2)
  })

  it("reads every time when ADMIN_STATS_CACHE_SECONDS is 0", async () => {
    const running = await start({ ADMIN_STATS_CACHE_SECONDS: "0" })
    const created = await createGiveaway(running)
    expect((await stats(created.browser)).openGiveaways).toBe(1)

    await createGiveaway(running)

    expect((await stats(created.browser)).openGiveaways).toBe(2)
  })

  it("counts a streamer as returning when their second giveaway came within ADMIN_STATS_RETURN_DAYS", async () => {
    const running = await start()
    const created = await createGiveaway(running)
    running.clock.advance(dayMs)
    await createGiveaway(running)
    running.clock.advance(5000)

    expect((await stats(created.browser)).returningStreamers).toBe(1)
  })
})
