import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import type { PublicHistoryJson } from "@rafflink/core/http/json"
import { historyDataElementId } from "@rafflink/core/lib/page-paths"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
  document.getElementById(historyDataElementId)?.remove()
})

// What the server writes into the history page it serves.
function embed(json: string) {
  const element = document.createElement("script")
  element.type = "application/json"
  element.id = historyDataElementId
  element.textContent = json
  document.head.append(element)
}

const history: PublicHistoryJson = {
  streamer: { platform: "twitch", login: "streamy", displayName: "Streamy", indexed: false },
  giveaways: [
    {
      code: "ABCDE",
      title: "Summer giveaway",
      prize: "A gaming chair",
      closedAt: Date.UTC(2026, 10, 20, 12),
      entrantCount: 42,
      winners: 2,
    },
    {
      code: "FGHJK",
      title: null,
      prize: "A mouse",
      closedAt: Date.UTC(2026, 10, 1, 12),
      entrantCount: 1,
      winners: 1,
    },
  ],
}

describe("public history page", () => {
  it("lists each finished giveaway with its date, counts and a link to its verify page, without asking who is signed in", async () => {
    const requests = mockFetch({ "GET /api/s/twitch/streamy": () => ok(history) })

    const view = renderApp("/s/twitch/streamy")

    expect(
      await view.findByRole("heading", { level: 1, name: "Giveaways of Streamy" }),
    ).toBeTruthy()
    const [summer, mouse] = view.getAllByRole("listitem")
    if (summer === undefined || mouse === undefined) throw new Error("two giveaways expected")
    expect(within(summer).getByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(within(summer).getByText("Prize: A gaming chair")).toBeTruthy()
    expect(
      within(summer).getByText(/Entries closed .* · 42 people entered · 2 winners/),
    ).toBeTruthy()
    expect(
      within(summer)
        .getByRole("link", { name: "Verify the draw of Summer giveaway" })
        .getAttribute("href"),
    ).toBe("/ABCDE/verify")
    expect(within(mouse).getByRole("heading", { name: "A mouse" })).toBeTruthy()
    expect(within(mouse).queryByText(/Prize:/)).toBeNull()
    expect(within(mouse).getByText(/1 person entered · 1 winner$/)).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual(["GET /api/s/twitch/streamy"])
  })

  it("says so when the streamer has no finished giveaway yet", async () => {
    mockFetch({ "GET /api/s/twitch/streamy": () => ok({ ...history, giveaways: [] }) })

    const view = renderApp("/s/twitch/streamy")

    expect(await view.findByText("No finished giveaways yet.")).toBeTruthy()
  })

  it("shows not found when the streamer has not turned the page on", async () => {
    mockFetch({
      "GET /api/s/twitch/streamy": () => ({ status: 404, body: { error: "not-found" } }),
    })

    const view = renderApp("/s/twitch/streamy")

    expect(
      await view.findByRole("heading", { name: "This streamer has no public giveaway history" }),
    ).toBeTruthy()
  })

  it("shows the history the server put into the page without asking the API, and asks it on the next visit", async () => {
    const requests = mockFetch({ "GET /api/s/twitch/streamy": () => ok(history) })
    embed(JSON.stringify(history))

    const first = renderApp("/s/twitch/streamy")
    expect(
      await first.findByRole("heading", { level: 1, name: "Giveaways of Streamy" }),
    ).toBeTruthy()
    const before = requests.length
    cleanup()
    const second = renderApp("/s/twitch/streamy")
    expect(
      await second.findByRole("heading", { level: 1, name: "Giveaways of Streamy" }),
    ).toBeTruthy()

    expect(before).toBe(0)
    expect(requests.map((request) => request.route)).toEqual(["GET /api/s/twitch/streamy"])
  })

  it("shows not found from the page's empty history without asking the API", async () => {
    const requests = mockFetch({})
    embed("null")

    const view = renderApp("/s/twitch/streamy")

    expect(
      await view.findByRole("heading", { name: "This streamer has no public giveaway history" }),
    ).toBeTruthy()
    expect(requests).toEqual([])
  })
})
