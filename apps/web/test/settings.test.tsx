import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { dashboardGiveaway, supportedSession } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const spammer = {
  platform: "twitch",
  platformUserId: "u1",
  login: "spammer",
  createdAt: 1_700_000_000_000,
}
const troll = {
  platform: "twitch",
  platformUserId: "u2",
  login: "troll",
  createdAt: 1_700_000_100_000,
}

/** The block list the server holds, answered by GET and changed by the test's own POST routes. */
function withBlocks(initial: readonly (typeof spammer)[], max = 100) {
  const state = { blocks: initial }
  return {
    state,
    routes: {
      "GET /api/dash/blocks": () => ok({ blocks: state.blocks, blockListMax: max }),
    },
  }
}

describe("settings block list", () => {
  it("lists the blocked accounts with their date, the count against the limit and a Remove button each", async () => {
    mockFetch(withBlocks([troll, spammer], 50).routes)

    const view = renderApp("/dashboard/settings")

    expect(await view.findByRole("heading", { name: "Blocked accounts" })).toBeTruthy()
    expect(await view.findByText("2 of 50 accounts blocked")).toBeTruthy()
    const rows = Array.from(
      view.container.querySelectorAll(".block-list li"),
      (row) => row.textContent,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/^troll\s+blocked Nov 1[45], 2023/)
    expect(rows[1]).toMatch(/^spammer\s+blocked Nov 1[45], 2023/)
    expect(view.getByRole("button", { name: "Remove spammer from the block list" })).toBeTruthy()
  })

  it("says so when no account is blocked", async () => {
    mockFetch(withBlocks([]).routes)

    const view = renderApp("/dashboard/settings")

    expect(await view.findByText("No accounts blocked.")).toBeTruthy()
    expect(view.queryByText("0 of 100 accounts blocked")).toBeNull()
  })

  it("blocks the typed login, clears the field and lists the new account", async () => {
    const { state, routes } = withBlocks([])
    const requests = mockFetch({
      ...routes,
      "POST /api/dash/blocks": () => {
        state.blocks = [spammer]
        return { status: 201, body: { kind: "added", block: spammer } }
      },
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.change(await view.findByLabelText("Username to block"), {
      target: { value: "@Spammer" },
    })
    fireEvent.click(view.getByRole("button", { name: "Block" }))

    expect(await view.findByText("Account blocked.")).toBeTruthy()
    expect(
      await view.findByRole("button", { name: "Remove spammer from the block list" }),
    ).toBeTruthy()
    expect(inputOf(view.getByLabelText("Username to block")).value).toBe("")
    expect(requests.find((request) => request.route === "POST /api/dash/blocks")?.body).toEqual({
      login: "@Spammer",
    })
  })

  it("says an account is already blocked", async () => {
    mockFetch({
      ...withBlocks([spammer]).routes,
      "POST /api/dash/blocks": () => ok({ kind: "exists", block: spammer }),
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.change(await view.findByLabelText("Username to block"), {
      target: { value: "spammer" },
    })
    fireEvent.click(view.getByRole("button", { name: "Block" }))

    expect(await view.findByText("This account is already blocked.")).toBeTruthy()
  })

  it.each([
    [400, { error: "invalid-input", field: "login" }, "Enter a username."],
    [404, { error: "unknown-login" }, "There is no account with that username."],
    [409, { error: "block-list-full" }, "The block list is full. Remove an account first."],
    [
      503,
      { error: "platform-unavailable" },
      "The streaming platform did not answer. Try again in a moment.",
    ],
    [401, { error: "unauthorized" }, "Something went wrong. Try again."],
  ])("explains a refused block (%d) and keeps what was typed", async (status, body, message) => {
    mockFetch({ ...withBlocks([]).routes, "POST /api/dash/blocks": () => ({ status, body }) })

    const view = renderApp("/dashboard/settings")
    fireEvent.change(await view.findByLabelText("Username to block"), {
      target: { value: "nobody" },
    })
    fireEvent.click(view.getByRole("button", { name: "Block" }))

    expect(await view.findByText(message)).toBeTruthy()
    expect(inputOf(view.getByLabelText("Username to block")).value).toBe("nobody")
  })

  it("lists an account that was saved while a running giveaway did not get the list, and says to repeat", async () => {
    const { state, routes } = withBlocks([])
    mockFetch({
      ...routes,
      "POST /api/dash/blocks": () => {
        state.blocks = [spammer]
        return { status: 503, body: { error: "room-unavailable" } }
      },
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.change(await view.findByLabelText("Username to block"), {
      target: { value: "spammer" },
    })
    fireEvent.click(view.getByRole("button", { name: "Block" }))

    expect(
      await view.findByText(/Saved, but a running giveaway did not get the change/),
    ).toBeTruthy()
    expect(
      await view.findByRole("button", { name: "Remove spammer from the block list" }),
    ).toBeTruthy()
  })

  it("removes an account from the list", async () => {
    const { state, routes } = withBlocks([troll, spammer])
    const requests = mockFetch({
      ...routes,
      "POST /api/dash/blocks/u1/delete": () => {
        state.blocks = [troll]
        return ok({ kind: "removed" })
      },
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.click(await view.findByRole("button", { name: "Remove spammer from the block list" }))

    expect(await view.findByText("Account removed from the block list.")).toBeTruthy()
    // The message can render before the reloaded list. A failing toBeNull() on the row's button would
    // format the React-owned element for seconds, past waitFor's timeout, so no check would follow the
    // reload; a boolean fails cheaply and waitFor keeps polling.
    await waitFor(() =>
      expect(
        view.queryByRole("button", { name: "Remove spammer from the block list" }) === null,
      ).toBe(true),
    )
    expect(view.getByRole("button", { name: "Remove troll from the block list" })).toBeTruthy()
    expect(
      requests.find((request) => request.route === "POST /api/dash/blocks/u1/delete")?.body,
    ).toEqual({})
  })

  it("keeps the row and says to try again when a running giveaway did not get the removal", async () => {
    mockFetch({
      ...withBlocks([spammer]).routes,
      "POST /api/dash/blocks/u1/delete": () => ({
        status: 503,
        body: { error: "room-unavailable" },
      }),
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.click(await view.findByRole("button", { name: "Remove spammer from the block list" }))

    expect(
      await view.findByText(/Saved, but a running giveaway did not get the change/),
    ).toBeTruthy()
    expect(view.getByRole("button", { name: "Remove spammer from the block list" })).toBeTruthy()
  })

  it("offers a reload when the block list cannot be loaded", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    let calls = 0
    mockFetch({
      "GET /api/dash/blocks": () => {
        calls += 1
        return calls === 1
          ? { status: 500, body: null }
          : ok({ blocks: [spammer], blockListMax: 100 })
      },
    })

    const view = renderApp("/dashboard/settings")
    expect(await view.findByText("Something went wrong. Reload the page.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Reload page" }))

    expect(
      await view.findByRole("button", { name: "Remove spammer from the block list" }),
    ).toBeTruthy()
  })

  it("asks a signed-out streamer to sign in and brings them back to the settings", async () => {
    mockFetch({ "GET /api/dash/blocks": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/dashboard/settings")

    expect(
      (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/streamer/start?return=%2Fdashboard%2Fsettings")
    expect(view.queryByLabelText("Username to block")).toBeNull()
  })
})

describe("settings public history", () => {
  it("turns the public history on and then links to the page", async () => {
    let publicHistory = false
    const requests = mockFetch({
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, publicHistory },
        }),
      "POST /api/dash/history": () => {
        publicHistory = true
        return ok({ kind: "saved", on: true })
      },
    })

    const view = renderApp("/dashboard/settings")
    expect(view.queryByRole("link", { name: "Open your public history page" })).toBeNull()
    fireEvent.click(await view.findByRole("button", { name: "Turn on public history" }))

    expect(
      (await view.findByRole("link", { name: "Open your public history page" })).getAttribute(
        "href",
      ),
    ).toBe("/s/twitch/streamy")
    expect(view.getByRole("button", { name: "Turn off public history" })).toBeTruthy()
    expect(requests.find((request) => request.route === "POST /api/dash/history")?.body).toEqual({
      on: true,
    })
  })

  it("lets search engines index the page while it is on", async () => {
    let historyIndexed = false
    const requests = mockFetch({
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, publicHistory: true, historyIndexed },
        }),
      "POST /api/dash/history/indexing": () => {
        historyIndexed = true
        return ok({ kind: "saved", on: true })
      },
    })

    const view = renderApp("/dashboard/settings")
    expect(await view.findByText("Search engines do not index the page.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Let search engines index it" }))

    expect(await view.findByRole("button", { name: "Stop search engine indexing" })).toBeTruthy()
    expect(
      requests.find((request) => request.route === "POST /api/dash/history/indexing")?.body,
    ).toEqual({ on: true })
  })

  it("offers no indexing switch while the page is off", async () => {
    mockFetch({ "GET /api/session": () => ok(supportedSession) })

    const view = renderApp("/dashboard/settings")

    expect(await view.findByRole("button", { name: "Turn on public history" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Let search engines index it" })).toBeNull()
  })
})

describe("settings account", () => {
  it("deletes all of the streamer's data once confirmed and then asks to sign in", async () => {
    let signedIn = true
    const requests = mockFetch({
      "GET /api/dash/blocks": () =>
        signedIn
          ? ok({ blocks: [], blockListMax: 100 })
          : { status: 401, body: { error: "unauthorized" } },
      "POST /api/dash/account/delete": () => {
        signedIn = false
        return ok({ kind: "deleted" })
      },
    })

    const view = renderApp("/dashboard/settings")
    fireEvent.click(await view.findByRole("button", { name: "Delete all my data" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, delete everything" }))

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
    expect(requests.map((request) => request.route)).toContain("POST /api/dash/account/delete")
  })
})

describe("settings page", () => {
  it("opens from the account menu, and the dashboard keeps only the giveaways", async () => {
    mockFetch({
      "GET /api/session": () => ok(supportedSession),
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }),
    })

    const view = renderApp("/dashboard")
    expect(await view.findByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Blocked accounts" })).toBeNull()
    expect(view.queryByRole("button", { name: "Delete all my data" })).toBeNull()
    expect(view.queryByText("Overlay style")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Streamy" }))
    fireEvent.click(view.getByRole("link", { name: "Settings" }))

    expect(await view.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy()
    expect(view.getByRole("heading", { name: "Public history" })).toBeTruthy()
    expect(view.getByRole("heading", { name: "Blocked accounts" })).toBeTruthy()
    expect(view.getByText("Overlay style")).toBeTruthy()
    expect(view.getByRole("button", { name: "Delete all my data" })).toBeTruthy()
  })
})
