import { afterEach, describe, expect, it, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"
import { dayMs, minuteMs, startOfDay, startOfMinute } from "../stats/time.ts"
import type { AdminStatsJson } from "./json.ts"

let harness: Harness | null = null

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
  await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")
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
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    expect((await new Browser(running).request("/api/admin/stats")).status).toBe(401)
    expect((await other.request("/api/admin/stats")).status).toBe(403)
  })

  it("lists the open giveaways with the counts of their rooms, and the day's growth", async () => {
    const running = await start()
    const created = await createGiveaway(running)
    running.rooms.roomFor(created.id)
    await running.deps.rooms.get(created.id).enter({
      platformUserId: users.viewer.id,
      login: users.viewer.login,
      displayName: users.viewer.displayName,
      profileImageUrl: null,
      isFollower: false,
      subTier: null,
      accountAgeDays: 100,
    })

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
    await waiting.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    expect((await stats(admin)).access).toEqual({ pending: 1, approved: 0, truncated: false })
  })

  it("returns one point per minute of the window, with the room minutes and the 429 minutes", async () => {
    const running = await start({ ADMIN_STATS_SERIES_MINUTES: "3" })
    const admin = await adminBrowser(running)
    const minute = startOfMinute(running.clock.now()) - minuteMs
    await running.deps.stats.addMinutes([{ minute, entries: 4, claims: 1 }], running.clock.now())
    running.queue.enqueue({ code: "c", giveawayId: "g", nonce: "n" }, "rate-limited")

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
