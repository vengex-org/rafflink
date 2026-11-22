import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { Browser, createHarness, users, type Harness } from "../../test/app-fixture.ts"

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

async function signedIn(userId: string, target: Harness = harness): Promise<Browser> {
  const browser = new Browser(target)
  await browser.signInAs(userId, "/auth/twitch/streamer/start")
  return browser
}

function switchPlan(
  browser: Browser,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return browser.request("/api/admin/plan", {
    method: "POST",
    headers: { "content-type": "application/json", origin: harness.config.publicUrl, ...headers },
    body: JSON.stringify(body),
  })
}

async function adminView(browser: Browser): Promise<Record<string, unknown>> {
  const response = await browser.request("/api/admin/usage")
  expect(response.status).toBe(200)
  return response.json()
}

describe("admin plan", () => {
  it("shows Free with its limits and the alert percent until an admin switches", async () => {
    harness.usage.usage = { workerRequests: 10, doRequests: 5 }

    expect(await adminView(await signedIn(users.streamerA.id))).toMatchObject({
      plan: {
        current: "free",
        limits: {
          workerRequestsPerDay: 100_000,
          doRequestsPerDay: 100_000,
          subrequestsPerInvocation: 45,
        },
      },
      usage: {
        workerRequests: { used: 10, limit: 100_000 },
        doRequests: { used: 5, limit: 100_000 },
      },
      alerts: [],
      alertPercent: 70,
    })
  })

  it("starts from CLOUDFLARE_PLAN while nothing is stored", async () => {
    const paid = await createHarness({ env: { CLOUDFLARE_PLAN: "paid" } })
    try {
      expect(await adminView(await signedIn(users.streamerA.id, paid))).toMatchObject({
        plan: { current: "paid" },
      })
    } finally {
      await paid.stop()
    }
  })

  it("stores a switch to Paid, pushes it to the queue and lifts the daily caps", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    const admin = await signedIn(users.streamerA.id)
    harness.usage.usage = { workerRequests: 90_000, doRequests: 5 }

    const response = await switchPlan(admin, { plan: "paid" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: "switched", plan: "paid" })
    expect(harness.planQueue?.plans).toEqual(["paid"])
    expect(await adminView(admin)).toMatchObject({
      plan: {
        current: "paid",
        limits: {
          workerRequestsPerDay: null,
          workerRequestsPerMonth: 10_000_000,
          subrequestsPerInvocation: 9_000,
        },
      },
      usage: { workerRequests: { used: 90_000, limit: null } },
      alerts: [],
    })
    expect(info).toHaveBeenCalledWith("cloudflare plan switched", { plan: "paid" })
  })

  it("keeps only the latest switch and remembers who made it", async () => {
    spyOn(console, "info").mockImplementation(() => {})
    const admin = await signedIn(users.streamerA.id)

    await switchPlan(admin, { plan: "paid" })
    await switchPlan(admin, { plan: "free" })

    expect(harness.accountsDb.query("SELECT plan, changed_by FROM cloudflare_plan").all()).toEqual([
      { plan: "free", changed_by: users.streamerA.id },
    ])
    expect(harness.planQueue?.plans).toEqual(["paid", "free"])
  })

  it("alerts on the admin page from 70 percent of a daily limit", async () => {
    const admin = await signedIn(users.streamerA.id)

    harness.usage.usage = { workerRequests: 69_999, doRequests: 0 }
    expect(await adminView(admin)).toMatchObject({ alerts: [] })

    harness.usage.usage = { workerRequests: 75_000, doRequests: 70_000 }
    expect(await adminView(admin)).toMatchObject({
      alerts: [
        { limit: "worker-requests", percent: 75 },
        { limit: "do-requests", percent: 70 },
      ],
    })
  })

  it("refuses a switch without a session, from a streamer who is not an admin, and changes nothing", async () => {
    const anonymous = new Browser(harness)
    const other = await signedIn(users.streamerB.id)

    expect((await switchPlan(anonymous, { plan: "paid" })).status).toBe(401)
    expect((await switchPlan(other, { plan: "paid" })).status).toBe(403)
    expect(harness.accountsDb.query("SELECT plan FROM cloudflare_plan").all()).toEqual([])
    expect(harness.planQueue?.plans).toEqual([])
  })

  it("refuses a switch from another origin, without an origin, or without a JSON body", async () => {
    const admin = await signedIn(users.streamerA.id)

    const evil = await switchPlan(admin, { plan: "paid" }, { origin: "https://evil.example" })
    const missing = await admin.request("/api/admin/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "paid" }),
    })
    const form = await switchPlan(admin, { plan: "paid" }, { "content-type": "text/plain" })

    expect(evil.status).toBe(403)
    expect(await evil.json()).toEqual({ error: "forbidden-origin" })
    expect(missing.status).toBe(403)
    expect(form.status).toBe(415)
    expect(harness.planQueue?.plans).toEqual([])
  })

  it("rejects a plan that is not free or paid", async () => {
    const admin = await signedIn(users.streamerA.id)

    for (const body of [{ plan: "pro" }, { plan: "Paid" }, { plan: 1 }, {}, null]) {
      const response = await switchPlan(admin, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "invalid-input", field: "plan" })
    }
    expect(harness.planQueue?.plans).toEqual([])
  })

  it("answers 503 when the queue cannot be told, with the plan already stored", async () => {
    spyOn(console, "info").mockImplementation(() => {})
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const admin = await signedIn(users.streamerA.id)
    if (harness.planQueue === null) throw new Error("expected a plan queue")
    harness.planQueue.failure = new Error("queue object unreachable")

    const response = await switchPlan(admin, { plan: "paid" })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "queue-unavailable" })
    expect(await adminView(admin)).toMatchObject({ plan: { current: "paid" } })
    expect(warn).toHaveBeenCalledWith("plan switch did not reach the queue", {
      plan: "paid",
      errorClass: "Error",
    })
  })

  it("has no plan on a target without a Cloudflare plan, and the switch answers 404", async () => {
    const bun = await createHarness({ target: "bun" })
    try {
      const admin = await signedIn(users.streamerA.id, bun)
      bun.usage.usage = null

      expect(await adminView(admin)).toMatchObject({ plan: null, usage: null, alerts: [] })
      const response = await admin.request("/api/admin/plan", {
        method: "POST",
        headers: { "content-type": "application/json", origin: bun.config.publicUrl },
        body: JSON.stringify({ plan: "paid" }),
      })
      expect(response.status).toBe(404)
    } finally {
      await bun.stop()
    }
  })
})
