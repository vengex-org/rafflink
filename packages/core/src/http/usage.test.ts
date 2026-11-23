import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { Browser, createHarness, users, validRules, type Harness } from "../../test/app-fixture.ts"
import { UsageUnavailable } from "../lib/usage-unavailable.ts"
import type { AsyncSql, DayRequests } from "../ports.ts"
import { YouTubeQuota } from "../youtube/quota.ts"

let harness: Harness
let browser: Browser

beforeEach(async () => {
  harness = await createHarness()
  browser = new Browser(harness)
  await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")
})

afterEach(async () => {
  await harness.stop()
})

// Free allows 100,000 Worker requests a day.
function usageWithRemaining(remaining: number): DayRequests {
  return { workerRequests: 100_000 - remaining, doRequests: 0 }
}

async function createWarnings(): Promise<unknown> {
  const response = await browser.postJson("/api/dash/giveaways", {
    title: "T",
    prize: "P",
    rules: validRules,
  })
  expect(response.status).toBe(201)
  const body: { warnings: unknown } = await response.json()
  return body.warnings
}

describe("usage warning at giveaway creation", () => {
  it("warns once fewer than 25,000 requests remain", async () => {
    harness.usage.usage = usageWithRemaining(24_999)

    expect(await createWarnings()).toEqual([{ kind: "worker-requests-low", remaining: 24_999 }])
  })

  it("does not warn at exactly 25,000 remaining", async () => {
    harness.usage.usage = usageWithRemaining(25_000)

    expect(await createWarnings()).toEqual([])
  })

  it("warns at zero remaining and when the limit is already exceeded", async () => {
    harness.usage.usage = usageWithRemaining(0)
    expect(await createWarnings()).toEqual([{ kind: "worker-requests-low", remaining: 0 }])

    harness.usage.usage = usageWithRemaining(-5)
    expect(await createWarnings()).toEqual([{ kind: "worker-requests-low", remaining: -5 }])
  })

  it("uses the configured threshold", async () => {
    await harness.stop()
    harness = await createHarness({ env: { USAGE_WARNING_THRESHOLD: "10" } })
    browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")
    harness.usage.usage = usageWithRemaining(10)
    expect(await createWarnings()).toEqual([])

    harness.usage.usage = usageWithRemaining(9)
    expect(await createWarnings()).toEqual([{ kind: "worker-requests-low", remaining: 9 }])
  })

  it("does not warn on a target without a daily limit", async () => {
    harness.usage.usage = null

    expect(await createWarnings()).toEqual([])
  })

  it("does not warn on Paid, which caps no day, unless WORKER_REQUEST_LIMIT sets a cap", async () => {
    harness.accountsDb.exec(
      "INSERT INTO cloudflare_plan (id, plan, changed_at, changed_by) VALUES (1, 'paid', 0, 'admin')",
    )
    harness.usage.usage = usageWithRemaining(0)
    expect(await createWarnings()).toEqual([])

    await harness.stop()
    harness = await createHarness({
      env: { CLOUDFLARE_PLAN: "paid", WORKER_REQUEST_LIMIT: "100000" },
    })
    browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")
    harness.usage.usage = usageWithRemaining(5)
    expect(await createWarnings()).toEqual([{ kind: "worker-requests-low", remaining: 5 }])
  })

  it("still creates the giveaway when the usage cannot be read", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    harness.usage.failure = new Error("analytics down")

    expect(await createWarnings()).toEqual([])
    expect(warn).toHaveBeenCalledWith("usage unavailable", { errorClass: "Error", reason: null })
    warn.mockRestore()
  })

  it("logs the reason of an unavailable usage source and nothing else from the request", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    harness.usage.failure = new UsageUnavailable("Analytics answered 403")

    expect(await createWarnings()).toEqual([])
    expect(warn).toHaveBeenCalledWith("usage unavailable", {
      errorClass: "UsageUnavailable",
      reason: "Analytics answered 403",
    })
    warn.mockRestore()
  })
})

async function budget(): Promise<unknown> {
  const response = await browser.request("/api/dash/request-budget")
  expect(response.status).toBe(200)
  return response.json()
}

describe("request budget for the wizard", () => {
  it("tells the daily limit and what is left of it today", async () => {
    harness.usage.usage = usageWithRemaining(60_000)

    expect(await budget()).toEqual({ budget: { limit: 100_000, remaining: 60_000 } })
  })

  it("tells no budget on a target without a daily limit, and when the usage cannot be read", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    harness.usage.usage = null
    const uncapped = await budget()
    harness.usage.failure = new Error("analytics down")

    expect([uncapped, await budget()]).toEqual([{ budget: null }, { budget: null }])
    warn.mockRestore()
  })

  it("answers only a signed-in streamer", async () => {
    const response = await new Browser(harness).request("/api/dash/request-budget")

    expect(response.status).toBe(401)
  })
})

describe("YouTube quota on the admin page", () => {
  it("says the YouTube count is unavailable when the accounts store does not answer", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    await harness.stop()
    const failing: AsyncSql = {
      all: async () => {
        throw new Error("store down")
      },
      run: async () => {},
      batch: async () => {},
    }
    harness = await createHarness({ youtubeQuota: new YouTubeQuota(failing, resolvedQuotaConfig) })
    browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const body: { youtubeQuota: unknown } = await (await browser.request("/api/admin/usage")).json()

    expect(body.youtubeQuota).toBe("unavailable")
  })

  it("shows no YouTube count on an install without a Google client", async () => {
    const body: { youtubeQuota: unknown } = await (await browser.request("/api/admin/usage")).json()

    expect(body.youtubeQuota).toBeNull()
  })
})

const resolvedQuotaConfig = {
  youtubeDailyQuotaUnits: 10_000,
  youtubeQuotaAlertPercent: 70,
  youtubeChatPollMinMs: 5000,
  youtubeWinnerPollMinMs: 30_000,
}
