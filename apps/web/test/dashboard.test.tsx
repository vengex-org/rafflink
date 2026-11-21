import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import { dashboardGiveaway, rules } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const listed = { "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }) }
const empty = { "GET /api/dash/giveaways": () => ok({ giveaways: [] }) }

describe("dashboard", () => {
  it("offers Sign in with Twitch to a signed-out streamer", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard")

    expect(
      (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/streamer/start")
  })

  it("teaches an empty dashboard in three steps with one button to start", async () => {
    mockFetch(empty)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Create your first giveaway" })).toBeTruthy()
    const steps = view.getAllByRole("listitem").map((item) => item.textContent)
    expect(steps).toEqual([
      "Create it. Say what you give away and who can enter.",
      "Share the link. Paste it in your chat. Viewers sign in with Twitch to enter.",
      "Draw live. Close entries and pick the winner on your stream.",
    ])
    fireEvent.click(view.getByRole("button", { name: "Create giveaway" }))
    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
  })

  it("lists each giveaway as a card with its prize, status and a link to its live page", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.getByText("Prize: A gaming chair")).toBeTruthy()
    expect(view.getByText("Entries open")).toBeTruthy()
    const meta = view.container.querySelector(".giveaway-meta")
    expect(meta?.textContent).toStartWith("Code ABCDE, created ")
    expect(meta?.querySelector(".code-tag")?.textContent).toBe("ABCDE")
    expect(view.getByRole("link", { name: "Open live page" }).getAttribute("href")).toBe(
      "/live/gid-1",
    )
  })

  it("names a giveaway without a title by its code and leaves out a missing prize", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({ giveaways: [{ ...dashboardGiveaway, title: null, prize: null }] }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Giveaway ABCDE" })).toBeTruthy()
    expect(view.queryByText(/Prize:/)).toBeNull()
  })

  it("keeps the link and overlay link of a listed giveaway at hand", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")

    expect(view.getByLabelText("Your link").getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
    expect(view.getByLabelText("Overlay link").getAttribute("value")).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])
  })

  it("copies the whole overlay link from an icon button beside its clipped address", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")
    fireEvent.click(view.getByRole("button", { name: "Copy overlay link" }))

    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/overlay/gid-1/tok-1"])
    const shown = view.getByText("http://rafflink.test/overlay/gid-1/tok-1", {
      selector: ".share-link-url",
    })
    expect(shown.getAttribute("data-clipped")).toBe("true")
  })

  it("shows the link without its protocol and the code marked, and the icon button copies the whole link", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")

    const shown = view.container.querySelector(".share-link-url")
    expect(shown?.textContent).toBe("rafflink.test/ABCDE")
    expect(shown?.querySelector("em")?.textContent).toBe("ABCDE")
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])
  })

  it("says how to copy by hand when the clipboard is refused", async () => {
    stubClipboard(true)
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))

    expect(await view.findByText(/Could not copy/)).toBeTruthy()
    expect(
      view.container.querySelector(".share-link .copy-button")?.getAttribute("data-state"),
    ).toBe("failed")
  })

  it("shows each status as a chip with its words", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...dashboardGiveaway, id: "a", code: "AAAAA", status: "open" },
            { ...dashboardGiveaway, id: "b", code: "BBBBB", status: "closed" },
            { ...dashboardGiveaway, id: "c", code: "CCCCC", status: "drawn" },
          ],
        }),
    })

    const view = renderApp("/dashboard")
    await view.findByText("Entries open")

    expect(
      view.getByText("Entries closed").closest(".status-chip")?.getAttribute("data-tone"),
    ).toBe("warning")
    expect(view.getByText("Winners drawn").closest(".status-chip")).toBeTruthy()
    expect(view.getByText("Entries open").closest(".status-chip")?.getAttribute("data-tone")).toBe(
      "success",
    )
  })

  it("pins the open giveaway above the others", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...dashboardGiveaway, id: "c", code: "CCCCC", title: "Old one", status: "drawn" },
            { ...dashboardGiveaway, id: "a", code: "AAAAA", title: "Current one", status: "open" },
          ],
        }),
    })

    const view = renderApp("/dashboard")

    const names = (await view.findAllByRole("heading", { level: 2 })).map((h) => h.textContent)
    expect(names).toEqual(["Current one", "Old one"])
  })

  it("opens the create form prefilled from a giveaway with entries ending left open", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            {
              ...dashboardGiveaway,
              closesAt: 4_102_444_800_000,
              rules: { ...rules, claimKeyword: "mine", minAccountAgeDays: 7 },
            },
          ],
        }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("button", { name: "Duplicate Summer giveaway" }))

    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    expect(inputOf(view.getByLabelText("Giveaway name (optional)")).value).toBe("Summer giveaway")
    expect(inputOf(view.getByLabelText("What does the winner get? (optional)")).value).toBe(
      "A gaming chair",
    )
    expect(inputOf(view.getByLabelText(/^When I close them/)).checked).toBe(true)
    expect(view.queryByLabelText("Entries end at")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Next" }))
    expect(inputOf(view.getByLabelText("Subscribers, tier 3")).value).toBe("5")
    expect(inputOf(view.getByLabelText("Moderators")).value).toBe("7")
    expect(inputOf(view.getByLabelText("Minimum account age in days (optional)")).value).toBe("7")
    expect(inputOf(view.getByLabelText("Chat word (optional)")).value).toBe("mine")
  })

  it("keeps a claim time outside the presets as a selected extra option", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({ giveaways: [{ ...dashboardGiveaway, claimSeconds: 90 }] }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("button", { name: "Duplicate Summer giveaway" }))
    fireEvent.click(await view.findByRole("button", { name: "Next" }))

    expect(inputOf(view.getByLabelText("1:30 minutes")).checked).toBe(true)
    expect(inputOf(view.getByLabelText("5 minutes")).checked).toBe(false)
  })
})
