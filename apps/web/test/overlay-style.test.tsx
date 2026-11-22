import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { defaultOverlayTheme, type OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { revealSoundPath } from "../src/lib/use-reveal-cue.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { dashboardGiveaway, giveaway, liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
  jest.useRealTimers()
})

const branded: OverlayTheme = {
  ...defaultOverlayTheme,
  accent: "#ff5500",
  background: "#ffffff",
  font: "oswald",
  size: "large",
  position: "bottom-right",
  corners: "square",
}
const cues: OverlayTheme = { ...defaultOverlayTheme, sound: true, confetti: true }

const winner = (n: number, name: string): LiveWinner => ({
  n,
  entrySeq: n + 1,
  displayName: name,
  profileImageUrl: null,
  claimUntil: 1,
  claim: { state: "claimed", at: 1, via: "chat" },
})
const drawnWith = (...winners: LiveWinner[]): LiveSnapshot => ({
  ...liveSnapshot,
  status: "drawn",
  winners,
})

type View = ReturnType<typeof renderApp>
const frame = (view: View) => view.container.querySelector("main.overlay")
const confetti = (view: View) => view.container.querySelector(".overlay-confetti")
const push = (snapshot: LiveSnapshot) => act(() => FakeSocket.opened[0]?.push(snapshot))

function openOverlay(snapshot: LiveSnapshot, theme: () => Reply = () => ok({ theme: cues })) {
  return mockFetch({
    "GET /api/overlay/gid-1/tok-1": () => ok(snapshot),
    "GET /api/overlay/gid-1/tok-1/theme": theme,
    "GET /api/g/ABCDE": () => ok({ ...giveaway, prize: null }),
  })
}

function stubPlay() {
  const played: string[] = []
  spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    played.push(new URL(this.src).pathname)
    return Promise.resolve()
  })
  return played
}

function reducedMotion(reduce: boolean) {
  spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

describe("overlay theme on the OBS overlay", () => {
  it("draws the default theme with no color of its own, so the overlay looks as before", async () => {
    openOverlay(liveSnapshot, () => ok({ theme: defaultOverlayTheme }))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(frame(view)?.getAttribute("style") ?? "").toBe("")
    expect(frame(view)?.getAttribute("data-font")).toBe("geist")
    expect(frame(view)?.getAttribute("data-size")).toBe("medium")
    expect(frame(view)?.getAttribute("data-position")).toBe("top-left")
    expect(frame(view)?.getAttribute("data-corners")).toBe("rounded")
  })

  it("draws the streamer's colors, font, size, corner and plates", async () => {
    openOverlay(liveSnapshot, () => ok({ theme: branded }))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    const root = frame(view)
    expect(root instanceof HTMLElement && root.style.getPropertyValue("--accent")).toBe("#ff5500")
    expect(root instanceof HTMLElement && root.style.getPropertyValue("--overlay-plate")).toBe(
      "#ffffff",
    )
    expect(root?.getAttribute("data-font")).toBe("oswald")
    expect(root?.getAttribute("data-size")).toBe("large")
    expect(root?.getAttribute("data-position")).toBe("bottom-right")
    expect(root?.getAttribute("data-corners")).toBe("square")
  })

  it("shows a style the streamer saves as soon as the socket pushes it, and keeps the snapshot", async () => {
    const requests = openOverlay(liveSnapshot, () => ok({ theme: defaultOverlayTheme }))
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(frame(view)?.getAttribute("data-position")).toBe("top-left"))

    push({ ...liveSnapshot, entrantCount: 11 })
    act(() => FakeSocket.opened[0]?.push({ theme: branded }))

    await waitFor(() => expect(frame(view)?.getAttribute("data-position")).toBe("bottom-right"))
    expect(view.getByText("11")).toBeTruthy()
    const themeReads = requests.filter((request) => request.route.endsWith("/theme"))
    expect(themeReads).toHaveLength(1)
  })

  it("reads the theme again after the socket reconnects, for a push it missed", async () => {
    let theme = defaultOverlayTheme
    const requests = openOverlay(liveSnapshot, () => ok({ theme }))
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(frame(view)).not.toBeNull())
    push(liveSnapshot)
    const themeReads = () => requests.filter((request) => request.route.endsWith("/theme"))
    expect(themeReads()).toHaveLength(1)

    theme = branded
    act(() => FakeSocket.opened[0]?.drop())
    await waitFor(() => expect(FakeSocket.opened).toHaveLength(2), { timeout: 3000 })
    act(() => FakeSocket.opened[1]?.push(liveSnapshot))

    await waitFor(() => expect(frame(view)?.getAttribute("data-position")).toBe("bottom-right"))
    expect(themeReads()).toHaveLength(2)
  })

  it("ignores a pushed theme the server would refuse", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    openOverlay(liveSnapshot, () => ok({ theme: defaultOverlayTheme }))
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(frame(view)).not.toBeNull())

    act(() => FakeSocket.opened[0]?.push({ theme: { ...branded, accent: "red" } }))

    expect(frame(view)?.getAttribute("data-position")).toBe("top-left")
    expect(error).toHaveBeenCalledWith("overlay theme push ignored", { field: "accent" })
  })

  it("falls back to the default theme when the theme cannot be loaded", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    openOverlay(liveSnapshot, () => ({ status: 500, body: { error: "boom" } }))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(frame(view)?.getAttribute("data-font")).toBe("geist")
    expect(warn).toHaveBeenCalledWith("overlay theme unavailable", {
      errorClass: "ApiError",
      round: 0,
    })
  })
})

describe("winner reveal cues", () => {
  it("plays the sound and throws confetti once a new winner shows", async () => {
    jest.useFakeTimers()
    reducedMotion(false)
    const played = stubPlay()
    openOverlay(liveSnapshot)
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(view.getByText("Ada")).toBeTruthy())
    expect(played).toEqual([])

    push(drawnWith(winner(0, "Wanda")))
    // The shuffle holds the plate back first; the cue comes with the plate.
    expect(played).toEqual([])
    await act(async () => jest.advanceTimersByTime(2000))

    await waitFor(() => expect(view.getAllByText("Wanda").length).toBeGreaterThan(0))
    expect(played).toEqual([revealSoundPath])
    expect(confetti(view)).not.toBeNull()
  })

  it("plays nothing for the winners already standing when the overlay loads", async () => {
    const played = stubPlay()
    openOverlay(drawnWith(winner(0, "Wanda")))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Wanda")).toBeTruthy()
    expect(played).toEqual([])
    expect(confetti(view)).toBeNull()
  })

  it("keeps the sound but leaves out the confetti under reduced motion", async () => {
    jest.useFakeTimers()
    reducedMotion(true)
    const played = stubPlay()
    openOverlay(liveSnapshot)
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(view.getByText("Ada")).toBeTruthy())

    push(drawnWith(winner(0, "Wanda")))
    await act(async () => jest.advanceTimersByTime(2000))

    await waitFor(() => expect(played).toEqual([revealSoundPath]))
    expect(confetti(view)).toBeNull()
  })

  it("stays silent and still with the default theme", async () => {
    jest.useFakeTimers()
    const played = stubPlay()
    openOverlay(liveSnapshot, () => ok({ theme: defaultOverlayTheme }))
    const view = renderApp("/overlay/gid-1/tok-1")
    await waitFor(() => expect(view.getByText("Ada")).toBeTruthy())

    push(drawnWith(winner(0, "Wanda")))
    await act(async () => jest.advanceTimersByTime(2000))

    await waitFor(() => expect(view.getAllByText("Wanda").length).toBeGreaterThan(0))
    expect(played).toEqual([])
    expect(confetti(view)).toBeNull()
  })
})

/** Opens a closed `details` the way a click on its summary does. */
function expand(view: View, summary: string) {
  const details = view.getByText(summary).closest("details")
  act(() => {
    if (details === null) throw new Error(`no disclosure ${summary}`)
    details.open = true
    details.dispatchEvent(new Event("toggle"))
  })
}

const previewFrame = (view: View) => view.container.querySelector(".overlay-preview .overlay")

describe("overlay style on the dashboard", () => {
  it("loads the style when opened, previews each change and saves it", async () => {
    const requests = mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }),
      "GET /api/dash/overlay-theme": () => ok({ theme: defaultOverlayTheme }),
      "POST /api/dash/overlay-theme": () => ok({ kind: "saved", theme: branded }),
    })
    const view = renderApp("/dashboard")
    await view.findByText("Overlay style")
    expect(requests.some((request) => request.route === "GET /api/dash/overlay-theme")).toBe(false)

    expand(view, "Overlay style")
    const accent = await view.findByLabelText("Accent")
    fireEvent.change(accent, { target: { value: "#ff5500" } })
    fireEvent.click(view.getByRole("radio", { name: "Bottom right" }))
    fireEvent.click(view.getByRole("radio", { name: "Oswald" }))

    const preview = previewFrame(view)
    expect(preview instanceof HTMLElement && preview.style.getPropertyValue("--accent")).toBe(
      "#ff5500",
    )
    expect(preview?.getAttribute("data-position")).toBe("bottom-right")
    expect(preview?.getAttribute("data-font")).toBe("oswald")

    fireEvent.click(view.getByRole("button", { name: "Save style" }))

    expect(await view.findByText("Saved. OBS shows the new style right away.")).toBeTruthy()
    expect(
      requests.find((request) => request.route === "POST /api/dash/overlay-theme")?.body,
    ).toEqual({
      ...defaultOverlayTheme,
      accent: "#ff5500",
      position: "bottom-right",
      font: "oswald",
    })
  })

  it("says so when the server refuses the style", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }),
      "GET /api/dash/overlay-theme": () => ok({ theme: defaultOverlayTheme }),
      "POST /api/dash/overlay-theme": () => ({
        status: 400,
        body: { error: "invalid-input", field: "accent", code: "not-a-color" },
      }),
    })
    const view = renderApp("/dashboard")
    await view.findByText("Overlay style")

    expand(view, "Overlay style")
    fireEvent.click(await view.findByRole("button", { name: "Save style" }))

    expect(
      await view.findByText("The style was not saved. Reload the page and try again."),
    ).toBeTruthy()
  })

  it("puts the default back in the form", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }),
      "GET /api/dash/overlay-theme": () => ok({ theme: branded }),
    })
    const view = renderApp("/dashboard")
    await view.findByText("Overlay style")
    expand(view, "Overlay style")
    await view.findByLabelText("Accent")
    expect(previewFrame(view)?.getAttribute("data-font")).toBe("oswald")

    fireEvent.click(view.getByRole("button", { name: "Back to default" }))

    expect(previewFrame(view)?.getAttribute("data-font")).toBe("geist")
    expect(previewFrame(view)?.getAttribute("style") ?? "").toBe("")
  })

  it("warns under the preview while the text is hard to read on the plates", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }),
      "GET /api/dash/overlay-theme": () => ok({ theme: defaultOverlayTheme }),
    })
    const view = renderApp("/dashboard")
    await view.findByText("Overlay style")
    expand(view, "Overlay style")
    const warning = "The text is hard to read on these plates. Pick a lighter or darker text color."
    expect(await view.findByLabelText("Text")).toBeTruthy()
    expect(view.queryByText(warning)).toBeNull()

    fireEvent.change(view.getByLabelText("Text"), { target: { value: "#202022" } })

    expect(view.getByText(warning)).toBeTruthy()
  })
})

/** The streamer's live page whose giveaway has `own` as its theme and `branded` as the streamer's. */
function openLive(own: OverlayTheme | null) {
  return mockFetch({
    "GET /api/g/ABCDE": () => ok(giveaway),
    "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }),
    "GET /api/dash/giveaways/gid-1/overlay-theme": () => ok({ own, streamer: branded }),
    "POST /api/dash/giveaways/gid-1/overlay-theme": () => ok({ kind: "saved", own: null }),
  })
}

describe("overlay style of one giveaway on the live page", () => {
  it("follows the streamer's style until the giveaway gets its own", async () => {
    const requests = openLive(null)
    const view = renderApp("/live/gid-1")
    await view.findByText("Style of this overlay")

    expand(view, "Style of this overlay")
    const mine = await view.findByRole("radio", { name: "My style" })
    expect(mine instanceof HTMLInputElement && mine.checked).toBe(true)
    expect(view.queryByLabelText("Accent")).toBeNull()
    expect(previewFrame(view)?.getAttribute("data-font")).toBe("oswald")

    fireEvent.click(view.getByRole("radio", { name: "Only this giveaway" }))
    fireEvent.click(view.getByRole("radio", { name: "Top left" }))
    fireEvent.click(view.getByRole("button", { name: "Save style" }))

    await waitFor(() =>
      expect(
        requests.find((request) => request.route === "POST /api/dash/giveaways/gid-1/overlay-theme")
          ?.body,
      ).toEqual({ theme: { ...branded, position: "top-left" } }),
    )
  })

  it("gives the giveaway back the streamer's style", async () => {
    const requests = openLive({ ...branded, corners: "rounded" })
    const view = renderApp("/live/gid-1")
    await view.findByText("Style of this overlay")
    expand(view, "Style of this overlay")
    const own = await view.findByRole("radio", { name: "Only this giveaway" })
    expect(own instanceof HTMLInputElement && own.checked).toBe(true)

    fireEvent.click(view.getByRole("radio", { name: "My style" }))
    const form = view.container.querySelector(".overlay-style")
    if (!(form instanceof HTMLElement)) throw new Error("no style form")
    fireEvent.click(within(form).getByRole("button", { name: "Save style" }))

    await waitFor(() =>
      expect(
        requests.find((request) => request.route === "POST /api/dash/giveaways/gid-1/overlay-theme")
          ?.body,
      ).toEqual({ theme: null }),
    )
  })
})
