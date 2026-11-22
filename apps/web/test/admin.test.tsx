import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const queue = {
  queued: 7,
  ratePerSecond: 10,
  cooldownUntil: 0,
  dropped: 2,
  abandonedResults: 1,
  lostClaims: 3,
}
const quota = (used: number, limit: number | null) => ({ used, limit })
const freeLimits = {
  workerRequestsPerDay: 100_000,
  doRequestsPerDay: 100_000,
  workerRequestsPerMonth: null,
  doRequestsPerMonth: null,
  subrequestsPerInvocation: 45,
}
const paidLimits = {
  workerRequestsPerDay: null,
  doRequestsPerDay: null,
  workerRequestsPerMonth: 10_000_000,
  doRequestsPerMonth: 1_000_000,
  subrequestsPerInvocation: 9_000,
}
const freePlan = { current: "free", limits: freeLimits }
const paidPlan = { current: "paid", limits: paidLimits }
const freeUsage = (workers: number, durableObjects = 5) => ({
  workerRequests: quota(workers, 100_000),
  doRequests: quota(durableObjects, 100_000),
})

function adminAnswer(overrides: Record<string, unknown> = {}) {
  return ok({ usage: null, plan: null, alerts: [], alertPercent: 70, queue, ...overrides })
}

describe("admin page", () => {
  it("shows the usage as bars with a sentence and the queue counters with labels", async () => {
    mockFetch({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(62_000), plan: freePlan }),
    })

    const view = renderApp("/admin")

    expect(await view.findByText("62,000 of 100,000 requests used today")).toBeTruthy()
    expect(view.getByText("5 of 100,000 requests used today")).toBeTruthy()
    const bar = view.getByRole("progressbar", { name: "Worker requests" })
    expect(bar.getAttribute("value")).toBe("62000")
    expect(bar.getAttribute("max")).toBe("100000")
    expect(view.getByText("7")).toBeTruthy()
    expect(view.getByText("entries waiting")).toBeTruthy()
    expect(view.getByText("none")).toBeTruthy()
    expect(view.getByText("3")).toBeTruthy()
    expect(view.getByText("entries processed twice, one result discarded")).toBeTruthy()
  })

  it("says the usage is unavailable when the usage source did not answer", async () => {
    mockFetch({ "GET /api/admin/usage": () => adminAnswer({ usage: "unavailable" }) })

    const view = renderApp("/admin")

    expect(await view.findByText("Today's usage is unavailable right now.")).toBeTruthy()
    expect(view.getByText("7")).toBeTruthy()
  })

  it("says there is no daily limit when the target has none", async () => {
    mockFetch({ "GET /api/admin/usage": () => adminAnswer() })

    const view = renderApp("/admin")

    expect(await view.findByText("This server has no daily request limit.")).toBeTruthy()
  })

  it("hides the plan switch on a target without a Cloudflare plan", async () => {
    mockFetch({ "GET /api/admin/usage": () => adminAnswer() })

    const view = renderApp("/admin")

    expect(await view.findByText("This server has no daily request limit.")).toBeTruthy()
    expect(view.queryByRole("radio", { name: "Paid" })).toBeNull()
  })

  it("shows the active Free limits and switches to Paid only after the confirm step", async () => {
    let plan: unknown = freePlan
    const requests = mockFetch({
      "GET /api/admin/usage": () =>
        adminAnswer({
          usage:
            plan === paidPlan
              ? { workerRequests: quota(10, null), doRequests: quota(5, null) }
              : freeUsage(10),
          plan,
        }),
      "POST /api/admin/plan": () => {
        plan = paidPlan
        return ok({ kind: "switched", plan: "paid" })
      },
    })

    const view = renderApp("/admin")

    expect(
      await view.findByText("Pay for Workers Paid in the Cloudflare dashboard first, then switch."),
    ).toBeTruthy()
    expect(view.getByRole("link", { name: "Cloudflare plans" }).getAttribute("href")).toBe(
      "https://www.cloudflare.com/plans/developer-platform/",
    )
    expect(view.getByRole("radio", { name: "Free" })).toHaveProperty("checked", true)
    expect(view.getByText("Subrequests per entry line call").nextSibling?.textContent).toBe("45")

    fireEvent.click(view.getByRole("radio", { name: "Paid" }))
    expect(view.getByRole("region", { name: "Switch to Paid?" })).toBeTruthy()
    expect(requests.some((request) => request.route === "POST /api/admin/plan")).toBe(false)

    fireEvent.click(view.getByRole("button", { name: "Switch to Paid" }))

    expect(await view.findByText("Plan switched.")).toBeTruthy()
    expect(requests.find((request) => request.route === "POST /api/admin/plan")?.body).toEqual({
      plan: "paid",
    })
    await waitFor(() =>
      expect(view.getByRole("radio", { name: "Paid" })).toHaveProperty("checked", true),
    )
    expect(view.getByText("Worker requests included per month").nextSibling?.textContent).toBe(
      "10,000,000",
    )
    expect(view.getAllByText("no daily limit")).toHaveLength(2)
    expect(view.getByText("10 requests today, no daily limit")).toBeTruthy()
    expect(view.queryByRole("region", { name: "Switch to Paid?" })).toBeNull()
  })

  it("cancels the confirm step without posting and keeps the current plan", async () => {
    const requests = mockFetch({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(10), plan: freePlan }),
    })

    const view = renderApp("/admin")
    fireEvent.click(await view.findByRole("radio", { name: "Paid" }))
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))

    expect(view.queryByRole("region", { name: "Switch to Paid?" })).toBeNull()
    expect(view.getByRole("radio", { name: "Free" })).toHaveProperty("checked", true)
    expect(requests.map((request) => request.route)).not.toContain("POST /api/admin/plan")
  })

  it("says the switch failed when the server refuses it", async () => {
    mockFetch({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(10), plan: freePlan }),
      "POST /api/admin/plan": () => ({ status: 503, body: { error: "queue-unavailable" } }),
    })

    const view = renderApp("/admin")
    fireEvent.click(await view.findByRole("radio", { name: "Paid" }))
    fireEvent.click(view.getByRole("button", { name: "Switch to Paid" }))

    expect(await view.findByText("The plan did not switch. Try again.")).toBeTruthy()
  })

  it("warns from 70 percent of a daily limit, naming the limit and the switch to Paid", async () => {
    mockFetch({
      "GET /api/admin/usage": () =>
        adminAnswer({
          usage: freeUsage(75_000, 70_000),
          plan: freePlan,
          alerts: [
            { limit: "worker-requests", percent: 75 },
            { limit: "do-requests", percent: 70 },
          ],
        }),
    })

    const view = renderApp("/admin")

    const alert = await view.findByRole("alert")
    expect(alert.textContent).toContain("Today's limit is getting close")
    expect(alert.textContent).toContain("Worker requests are at 75% of today's limit.")
    expect(alert.textContent).toContain("Durable Object requests are at 70% of today's limit.")
    expect(alert.textContent).toContain("pay for Workers Paid in the Cloudflare dashboard")
  })

  it("shows no warning below the alert percent", async () => {
    mockFetch({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(69_000), plan: freePlan }),
    })

    const view = renderApp("/admin")

    expect(await view.findByText("69,000 of 100,000 requests used today")).toBeTruthy()
    expect(view.queryByRole("alert")).toBeNull()
  })

  it("refuses a signed-in streamer who is not an admin", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 403, body: { error: "forbidden" } }) })

    const view = renderApp("/admin")

    expect(await view.findByText("This Twitch account is not an admin.")).toBeTruthy()
  })

  it("asks for a sign-in without a session", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/admin")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })
})
