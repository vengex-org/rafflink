import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
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
  rateLimited: 9,
  lastRateLimitedAt: 0,
  rateLimitedMinutes: [],
}
const quota = (used: number, limit: number | null) => ({ used, limit })
const notOverridden = {
  workerRequestsPerDay: false,
  doRequestsPerDay: false,
  subrequestsPerInvocation: false,
}
const freeLimits = {
  workerRequestsPerDay: 100_000,
  doRequestsPerDay: 100_000,
  workerRequestsPerMonth: null,
  doRequestsPerMonth: null,
  subrequestsPerInvocation: 45,
  overridden: notOverridden,
}
const paidLimits = {
  workerRequestsPerDay: null,
  doRequestsPerDay: null,
  workerRequestsPerMonth: 10_000_000,
  doRequestsPerMonth: 1_000_000,
  subrequestsPerInvocation: 9_000,
  overridden: notOverridden,
}
const freePlan = { current: "free", limits: freeLimits }
const paidPlan = { current: "paid", limits: paidLimits }
const freeUsage = (workers: number, durableObjects = 5) => ({
  workerRequests: quota(workers, 100_000),
  doRequests: quota(durableObjects, 100_000),
})

function adminAnswer(overrides: Record<string, unknown> = {}) {
  return ok({
    usage: null,
    plan: null,
    alerts: [],
    alertPercent: 70,
    signupOpen: true,
    queue,
    youtubeQuota: null,
    ...overrides,
  })
}

const emptyStats = {
  generatedAt: 0,
  openGiveaways: 0,
  giveaways: [],
  viewers: 0,
  entriesLastMinute: 0,
  claimsLastMinute: 0,
  series: [],
  growth: [],
  returningStreamers: 0,
  returningWithinDays: 30,
  access: null,
  referrals: [],
}

/** Like `mockFetch`, and the live statistics repeat the usage and the queue the usage route answers, so each test states them once. */
function mockAdmin(routes: Readonly<Record<string, () => Reply | Promise<Reply>>>) {
  const usageRoute = routes["GET /api/admin/usage"]
  const polled = async () => {
    const body: unknown =
      usageRoute === undefined ? { usage: null, queue } : (await usageRoute()).body
    const { usage, queue: polledQueue } =
      typeof body === "object" && body !== null ? Object.fromEntries(Object.entries(body)) : {}
    return ok({ ...emptyStats, usage: usage ?? null, queue: polledQueue ?? queue })
  }
  return mockFetch({
    "GET /api/admin/stats": polled,
    "GET /api/admin/stats?fresh=1": polled,
    ...routes,
  })
}

const list = (streamers: readonly unknown[], truncated = false) => ({ streamers, truncated })

describe("admin page", () => {
  it("shows the usage as bars with a sentence and the queue counters with labels", async () => {
    mockAdmin({
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

  it("shows today's YouTube units, and warns once they reach the alert percent", async () => {
    mockAdmin({
      "GET /api/admin/usage": () =>
        adminAnswer({ youtubeQuota: { used: 7_200, limit: 10_000, alert: true } }),
    })

    const view = renderApp("/admin")

    const bar = await view.findByRole("progressbar", { name: "YouTube units today" })
    expect(bar.getAttribute("value")).toBe("7200")
    expect(view.getByText("7,200 of 10,000 units used today")).toBeTruthy()
    expect(view.getByRole("alert").textContent).toContain("72% of the daily cap")
  })

  it("says the YouTube count is unavailable when the server could not read it", async () => {
    mockAdmin({ "GET /api/admin/usage": () => adminAnswer({ youtubeQuota: "unavailable" }) })

    const view = renderApp("/admin")
    const card = (await view.findByRole("heading", { name: "YouTube quota" })).closest("section")

    expect(card?.textContent).toContain("Today's usage is unavailable right now.")
    expect(view.queryByRole("progressbar", { name: "YouTube units today" })).toBeNull()
  })

  it("shows no YouTube quota on an install without YouTube", async () => {
    mockAdmin({ "GET /api/admin/usage": () => adminAnswer() })

    const view = renderApp("/admin")

    expect(await view.findByText("7")).toBeTruthy()
    expect(view.queryByText("YouTube quota")).toBeNull()
  })

  it("says the usage is unavailable when the usage source did not answer", async () => {
    mockAdmin({ "GET /api/admin/usage": () => adminAnswer({ usage: "unavailable" }) })

    const view = renderApp("/admin")

    expect(await view.findByText("Today's usage is unavailable right now.")).toBeTruthy()
    expect(view.getByText("7")).toBeTruthy()
  })

  it("says there is no daily limit when the target has none", async () => {
    mockAdmin({ "GET /api/admin/usage": () => adminAnswer() })

    const view = renderApp("/admin")

    expect(await view.findByText("This server has no daily request limit.")).toBeTruthy()
  })

  it("hides the plan switch on a target without a Cloudflare plan", async () => {
    mockAdmin({ "GET /api/admin/usage": () => adminAnswer() })

    const view = renderApp("/admin")

    expect(await view.findByText("This server has no daily request limit.")).toBeTruthy()
    expect(view.queryByRole("radio", { name: "Paid" })).toBeNull()
  })

  it("shows the active Free limits and switches to Paid only after the confirm step", async () => {
    let plan: unknown = freePlan
    const requests = mockAdmin({
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
    const plans = view.getByRole("link", { name: "Cloudflare plans" })
    expect(plans.getAttribute("target")).toBe("_blank")
    expect(plans.getAttribute("rel")).toBe("noopener noreferrer")
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
    expect(requests.map((request) => request.route)).toContain("GET /api/admin/stats?fresh=1")
  })

  it("cancels the confirm step without posting and keeps the current plan", async () => {
    const requests = mockAdmin({
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
    mockAdmin({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(10), plan: freePlan }),
      "POST /api/admin/plan": () => ({ status: 400, body: { error: "invalid-input" } }),
    })

    const view = renderApp("/admin")
    fireEvent.click(await view.findByRole("radio", { name: "Paid" }))
    fireEvent.click(view.getByRole("button", { name: "Switch to Paid" }))

    expect(await view.findByText("The plan did not switch. Try again.")).toBeTruthy()
    expect(view.getByRole("radio", { name: "Free" })).toHaveProperty("checked", true)
  })

  it("says the plan is saved and shows it when only the queue could not be told", async () => {
    let plan: unknown = freePlan
    mockAdmin({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(10), plan }),
      "POST /api/admin/plan": () => {
        plan = paidPlan
        return { status: 503, body: { error: "queue-unavailable" } }
      },
    })

    const view = renderApp("/admin")
    fireEvent.click(await view.findByRole("radio", { name: "Paid" }))
    fireEvent.click(view.getByRole("button", { name: "Switch to Paid" }))

    expect(
      await view.findByText(
        "The plan is saved, but the queue has not taken it yet. Switch again to retry.",
      ),
    ).toBeTruthy()
    expect(view.queryByText("The plan did not switch. Try again.")).toBeNull()
    await waitFor(() =>
      expect(view.getByRole("radio", { name: "Paid" })).toHaveProperty("checked", true),
    )
  })

  it("marks a limit that an env override sets", async () => {
    const overridden = { ...notOverridden, workerRequestsPerDay: true }
    mockAdmin({
      "GET /api/admin/usage": () =>
        adminAnswer({
          usage: freeUsage(10),
          plan: { current: "free", limits: { ...freeLimits, overridden } },
        }),
    })

    const view = renderApp("/admin")

    const row = (await view.findByText("Worker requests per day")).nextSibling
    expect(row?.textContent).toBe("100,000 set in env")
    expect(view.getAllByText("set in env")).toHaveLength(1)
  })

  it("warns from 70 percent of a daily limit, naming the limit and the switch to Paid", async () => {
    mockAdmin({
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
    mockAdmin({
      "GET /api/admin/usage": () => adminAnswer({ usage: freeUsage(69_000), plan: freePlan }),
    })

    const view = renderApp("/admin")

    expect(await view.findByText("69,000 of 100,000 requests used today")).toBeTruthy()
    expect(view.queryByRole("alert")).toBeNull()
  })

  it("refuses a signed-in streamer who is not an admin", async () => {
    mockAdmin({ "GET /api/admin/usage": () => ({ status: 403, body: { error: "forbidden" } }) })

    const view = renderApp("/admin")

    expect(await view.findByText("This Twitch account is not an admin.")).toBeTruthy()
  })

  it("asks for a sign-in without a session", async () => {
    mockAdmin({ "GET /api/admin/usage": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/admin")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })
  describe("streamer access", () => {
    const waiting = {
      id: "s-wait",
      login: "newbie",
      displayName: "Newbie",
      createdAt: 1_700_000_000_000,
      approvedAt: null,
    }
    const allowed = { ...waiting, id: "s-ok", login: "oldie", displayName: "Oldie", approvedAt: 1 }

    it("tells the admin when a list is cut", async () => {
      mockAdmin({
        "GET /api/admin/usage": () => adminAnswer({ signupOpen: false }),
        "GET /api/admin/streamers": () =>
          ok({ pending: list([waiting], true), approved: list([]) }),
      })

      const view = renderApp("/admin")

      expect(
        await view.findByText("More streamers exist than are listed. The newest are shown."),
      ).toBeTruthy()
    })

    it("shows no access section while signup is open", async () => {
      mockAdmin({ "GET /api/admin/usage": () => adminAnswer() })

      const view = renderApp("/admin")

      expect(await view.findByRole("heading", { name: "Entry line" })).toBeTruthy()
      expect(view.queryByRole("heading", { name: "Streamer access" })).toBeNull()
    })

    it("lists waiting and approved streamers with their login and first sign-in", async () => {
      mockAdmin({
        "GET /api/admin/usage": () => adminAnswer({ signupOpen: false }),
        "GET /api/admin/streamers": () =>
          ok({ pending: list([waiting]), approved: list([allowed]) }),
      })

      const view = renderApp("/admin")

      const section = await view.findByRole("region", { name: "Streamer access" })
      await within(section).findByText("Newbie")
      expect(within(section).getByText("@newbie")).toBeTruthy()
      expect(within(section).getAllByText(/^First sign-in /)).toHaveLength(2)
      expect(within(section).getByText("Oldie")).toBeTruthy()
      expect(within(section).getByRole("button", { name: "Approve Newbie" })).toBeTruthy()
      expect(within(section).getByRole("button", { name: "Revoke Oldie" })).toBeTruthy()
    })

    it("approves a waiting streamer and reloads the lists", async () => {
      let approved = false
      const requests = mockAdmin({
        "GET /api/admin/usage": () => adminAnswer({ signupOpen: false }),
        "GET /api/admin/streamers": () =>
          ok(
            approved
              ? { pending: list([]), approved: list([{ ...waiting, approvedAt: 2 }]) }
              : { pending: list([waiting]), approved: list([]) },
          ),
        "POST /api/admin/streamers/s-wait/approve": () => {
          approved = true
          return ok({ kind: "approved" })
        },
      })

      const view = renderApp("/admin")
      fireEvent.click(await view.findByRole("button", { name: "Approve Newbie" }))

      expect(await view.findByRole("button", { name: "Revoke Newbie" })).toBeTruthy()
      expect(view.getByText("Approved.")).toBeTruthy()
      expect(requests.map((request) => request.route)).toContain(
        "POST /api/admin/streamers/s-wait/approve",
      )
    })

    it("revokes an approved streamer", async () => {
      let revoked = false
      mockAdmin({
        "GET /api/admin/usage": () => adminAnswer({ signupOpen: false }),
        "GET /api/admin/streamers": () =>
          ok(
            revoked
              ? { pending: list([allowed]), approved: list([]) }
              : { pending: list([]), approved: list([allowed]) },
          ),
        "POST /api/admin/streamers/s-ok/revoke": () => {
          revoked = true
          return ok({ kind: "revoked" })
        },
      })

      const view = renderApp("/admin")
      fireEvent.click(await view.findByRole("button", { name: "Revoke Oldie" }))

      expect(await view.findByRole("button", { name: "Approve Oldie" })).toBeTruthy()
      expect(view.getByText("Approval revoked.")).toBeTruthy()
    })

    it("says so when the server refuses the decision", async () => {
      mockAdmin({
        "GET /api/admin/usage": () => adminAnswer({ signupOpen: false }),
        "GET /api/admin/streamers": () => ok({ pending: list([waiting]), approved: list([]) }),
        "POST /api/admin/streamers/s-wait/approve": () => ({
          status: 404,
          body: { error: "not-found" },
        }),
      })

      const view = renderApp("/admin")
      fireEvent.click(await view.findByRole("button", { name: "Approve Newbie" }))

      expect(
        await view.findByText("The change did not go through. Reload the page and try again."),
      ).toBeTruthy()
    })
  })
})
