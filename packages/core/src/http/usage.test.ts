import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { Browser, createHarness, users, validRules, type Harness } from "../../test/app-fixture.ts"
import { UsageUnavailable } from "../lib/usage-unavailable.ts"
import type { DayRequests } from "../ports.ts"

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
