import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import { dashboardGiveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
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
    expect(await view.findByText("Step 1 of 4: What you give away")).toBeTruthy()
  })

  it("lists each giveaway as a card with its prize, status and a link to its live page", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.getByText("Prize: A gaming chair")).toBeTruthy()
    expect(view.getByText("Entries open")).toBeTruthy()
    expect(view.getByText(/Code ABCDE/)).toBeTruthy()
    expect(view.getByRole("link", { name: "Open live page" }).getAttribute("href")).toBe(
      "/live/gid-1",
    )
  })

  it("keeps the link, chat message and overlay link of a listed giveaway at hand", async () => {
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
    fireEvent.click(view.getByRole("button", { name: "Copy chat message" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["Enter the giveaway: http://rafflink.test/ABCDE"])
  })

  it("says how to copy by hand when the clipboard is refused", async () => {
    stubClipboard(true)
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))

    expect(await view.findByText(/Could not copy/)).toBeTruthy()
  })
})
