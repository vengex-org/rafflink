import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"
import { act, cleanup, within } from "@testing-library/react"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

const now = Date.UTC(2026, 10, 22, 12)
const minute = 60_000
const day = 86_400_000
const statsRoute = "GET /api/admin/stats"

const queue = {
  queued: 0,
  ratePerSecond: 10,
  cooldownUntil: 0,
  dropped: 0,
  abandonedResults: 0,
  lostClaims: 0,
  rateLimited: 0,
  lastRateLimitedAt: 0,
  rateLimitedMinutes: [],
}

const usageAnswer = ok({
  usage: null,
  plan: null,
  alerts: [],
  alertPercent: 70,
  signupOpen: true,
  youtubeQuota: null,
  queue,
})

function statsBody(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: now,
    openGiveaways: 3,
    giveaways: [
      {
        code: "ABCDE",
        title: "Summer cup",
        streamerName: "Ann",
        closesAt: null,
        counts: { entrants: 120, entriesLastMinute: 15, claimsLastMinute: 1, viewers: 40 },
      },
      {
        code: "FGHJK",
        title: null,
        streamerName: "Bob",
        closesAt: now + day,
        counts: null,
      },
    ],
    viewers: 40,
    presence: { total: 9, byKind: { home: 3, legal: 1, dashboard: 2, giveaway: 2, other: 1 } },
    entriesLastMinute: 15,
    claimsLastMinute: 1,
    queue,
    usage: null,
    series: [
      { minute: now - 2 * minute, entries: 5, claims: 0, rateLimited: 0 },
      { minute: now - minute, entries: 20, claims: 3, rateLimited: 2 },
      { minute, entries: 0, claims: 0, rateLimited: 0 },
    ],
    growth: [
      { day: now - day, giveaways: 4, streamers: 1 },
      { day: now, giveaways: 6, streamers: 2 },
    ],
    returningStreamers: 5,
    returningWithinDays: 30,
    access: null,
    referrals: [
      { ref: "reddit", visits: 8 },
      { ref: "blog", visits: 3 },
    ],
    ...overrides,
  }
}

function mockAdmin(stats: () => Reply | Promise<Reply> = () => ok(statsBody())) {
  return mockFetch({ "GET /api/admin/usage": () => usageAnswer, [statsRoute]: stats })
}

const statsRequests = (requests: readonly { readonly route: string }[]) =>
  requests.filter((request) => request.route === statsRoute).length

function showAs(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true })
  act(() => void document.dispatchEvent(new Event("visibilitychange")))
}

// Bun's fake timers have no async advance: the answers of the mocked fetch settle in microtasks after it.
async function tick(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms)
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(now)
})

afterEach(() => {
  cleanup()
  showAs("visible")
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("admin page live numbers", () => {
  it("shows the key numbers with their labels and when they were read", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    const value = async (label: string) => (await view.findByText(label)).nextSibling?.textContent
    expect(await value("open giveaways")).toBe("3")
    expect(await value("viewers connected")).toBe("40")
    expect(await value("entries in the last minute")).toBe("15")
    expect(await value("claims in the last minute")).toBe("1")
    expect(await value("Twitch 429 responses in the last hour")).toBe("2")
    expect(
      view.getByText("Viewers, entries and claims cover the 2 newest of 3 open giveaways."),
    ).toBeTruthy()
    expect(view.getByText(/^Updated /)).toBeTruthy()
  })

  it("shows the people on the site in total and per page kind", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    const card = await view.findByRole("region", { name: "On the site now" })
    const value = (label: string) => within(card).getByText(label).nextSibling?.textContent
    expect(value("people on the site")).toBe("9")
    expect(value("home page")).toBe("3")
    expect(value("terms and privacy")).toBe("1")
    expect(value("dashboard and admin")).toBe("2")
    expect(value("giveaway pages")).toBe("2")
    expect(value("other pages")).toBe("1")
  })

  it("says the people on the site are unavailable when their count did not answer, and keeps the other numbers", async () => {
    mockAdmin(() => ok(statsBody({ presence: "unavailable" })))

    const view = renderApp("/admin")

    expect(
      await view.findByText("The count of people on the site is unavailable right now."),
    ).toBeTruthy()
    expect(view.queryByText("people on the site")).toBeNull()
    expect((await view.findByText("open giveaways")).nextSibling?.textContent).toBe("3")
  })

  it("lists the open giveaways with streamer, viewers, entries and end, a dash for a room that did not answer", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    const rows = (await view.findAllByRole("row")).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent),
    )
    expect(rows.find((row) => row[0] === "Ann")).toEqual([
      "Ann",
      "Summer cup",
      "40",
      "120",
      "when the streamer closes it",
    ])
    expect(rows.find((row) => row[0] === "Bob")?.slice(0, 4)).toEqual(["Bob", "FGHJK", "–", "–"])
  })

  it("says no giveaway is open when none is", async () => {
    mockAdmin(() => ok(statsBody({ openGiveaways: 0, giveaways: [] })))

    const view = renderApp("/admin")

    expect(await view.findByText("No giveaway is open.")).toBeTruthy()
  })

  it("draws the last hour and the growth as images with a text for the totals, marking the minute of a 429", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    expect(
      await view.findByRole("img", {
        name: "25 entries and 3 claims in the last hour, 2 Twitch 429 responses",
      }),
    ).toBeTruthy()
    expect(
      view.getByRole("img", { name: "10 giveaways and 3 new streamers in the last 2 days" }),
    ).toBeTruthy()
    expect(view.container.querySelectorAll(".chart-mark")).toHaveLength(1)
    expect(view.container.querySelectorAll(".chart-bar")).toHaveLength(4)
    expect(view.container.querySelectorAll("polyline")).toHaveLength(2)
  })

  it("lists the referral sources busiest first and says so when there is none", async () => {
    mockAdmin()
    const view = renderApp("/admin")
    const sources = (
      await view.findByRole("heading", { name: "Where visitors come from" })
    ).closest("section")
    expect(
      Array.from(sources?.querySelectorAll("tbody tr") ?? []).map((row) => row.textContent),
    ).toEqual(["reddit8", "blog3"])

    cleanup()
    mockAdmin(() => ok(statsBody({ referrals: [] })))
    const empty = renderApp("/admin")
    expect(await empty.findByText("No visit with a ref label yet.")).toBeTruthy()
  })

  it("shows the streamers waiting and approved only when signup is closed, with a plus when the count is cut", async () => {
    mockAdmin(() => ok(statsBody({ access: { pending: 4, approved: 200, truncated: true } })))

    const view = renderApp("/admin")

    expect((await view.findByText("streamers waiting for approval")).nextSibling?.textContent).toBe(
      "4+",
    )
    expect(view.getByText("approved streamers").nextSibling?.textContent).toBe("200+")
    expect(
      view.getByText("streamers with a second giveaway within 30 days of the first"),
    ).toBeTruthy()
  })

  it("shows no approval counts while signup is open", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    await view.findByText("open giveaways")
    expect(view.queryByText("streamers waiting for approval")).toBeNull()
  })

  it("shows the 429 count and the time of the last one in the entry line card", async () => {
    mockAdmin(() =>
      ok(statsBody({ queue: { ...queue, rateLimited: 12, lastRateLimitedAt: now - minute } })),
    )

    const view = renderApp("/admin")

    expect((await view.findByText("Twitch 429 responses")).nextSibling?.textContent).toBe("12")
    expect(view.getByText("last Twitch 429").nextSibling?.textContent).not.toBe("never")
  })

  it("says never when the token endpoint has not answered 429", async () => {
    mockAdmin()

    const view = renderApp("/admin")

    expect((await view.findByText("last Twitch 429")).nextSibling?.textContent).toBe("never")
  })
})

describe("admin page polling", () => {
  it("asks again every 30 seconds while the tab is visible", async () => {
    const requests = mockAdmin()
    const view = renderApp("/admin")
    await view.findByText("open giveaways")
    expect(statsRequests(requests)).toBe(1)

    // Waiting for the first answer moved the fake clock a little, so the first checks stay well inside one period.
    await tick(4_000)
    expect(statsRequests(requests)).toBe(1)
    await tick(30_000)
    expect(statsRequests(requests)).toBe(2)
    await tick(30_000)
    expect(statsRequests(requests)).toBe(3)
  })

  it("asks nothing while the tab is hidden and asks at once when it is shown again", async () => {
    const requests = mockAdmin()
    const view = renderApp("/admin")
    await view.findByText("open giveaways")

    showAs("hidden")
    await tick(60_000)
    expect(statsRequests(requests)).toBe(1)

    showAs("visible")
    await tick(0)
    expect(statsRequests(requests)).toBe(2)
    await tick(30_000)
    expect(statsRequests(requests)).toBe(3)
  })

  it("does not ask when the page opens in a hidden tab", async () => {
    showAs("hidden")
    const requests = mockAdmin()

    const view = renderApp("/admin")
    await view.findByRole("heading", { name: "Admin" })
    await tick(30_000)

    expect(statsRequests(requests)).toBe(0)
  })

  it("stops asking when the page is left", async () => {
    const requests = mockAdmin()
    const view = renderApp("/admin")
    await view.findByText("open giveaways")

    view.unmount()
    await tick(60_000)

    expect(statsRequests(requests)).toBe(1)
  })

  it("keeps the last numbers and says so when a poll fails, then recovers on the next", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    let failing = false
    mockAdmin(() => (failing ? { status: 500, body: { error: "internal" } } : ok(statsBody())))
    const view = renderApp("/admin")
    await view.findByText("open giveaways")

    failing = true
    await tick(30_000)

    expect(view.getByText("The live numbers could not be loaded. Trying again.")).toBeTruthy()
    expect(view.getByText("open giveaways").nextSibling?.textContent).toBe("3")

    failing = false
    await tick(30_000)

    expect(view.queryByText("The live numbers could not be loaded. Trying again.")).toBeNull()
  })

  it("shows the page without live numbers while the first poll has not answered", async () => {
    mockAdmin(() => new Promise<Reply>(() => {}))

    const view = renderApp("/admin")

    expect(await view.findByRole("heading", { name: "Admin" })).toBeTruthy()
    expect(view.queryByText("open giveaways")).toBeNull()
    expect(view.getByText("This server has no daily request limit.")).toBeTruthy()
  })
})
