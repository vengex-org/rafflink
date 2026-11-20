import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { reconnectDelayMs } from "../src/lib/use-live.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
})

const drawn: LiveSnapshot = {
  ...liveSnapshot,
  status: "drawn",
  winners: [
    { n: 0, displayName: "Wanda", claimUntil: 1, claim: { state: "waiting" } },
    { n: 1, displayName: "Bob", claimUntil: 1, claim: { state: "claimed", via: "chat" } },
  ],
}

describe("live page", () => {
  it("renders the snapshot and then every push of the socket", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(view.getByText("1.5")).toBeTruthy()
    expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/live/gid-1")
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 9, lastNames: ["Cy"] }))
    expect(await view.findByText("Cy")).toBeTruthy()
    expect(view.getByText("9")).toBeTruthy()
  })

  it("shows the failure counters", async () => {
    mockFetch({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, roleRefreshFailures: 4, eventSubFailures: 2 }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Role refresh failures")).toBeTruthy()
    expect(view.getByText("4")).toBeTruthy()
    expect(view.getByText("2")).toBeTruthy()
  })

  it("shows winners with how they claimed", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claimed in chat")).toBeTruthy()
    expect(view.getByText("Waiting to claim")).toBeTruthy()
  })

  it("shows Chat claim unavailable with a manual claim button that marks the claim", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }),
      "POST /api/dash/giveaways/gid-1/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(/Chat claim unavailable/)).toBeTruthy()
    fireEvent.click(view.getByLabelText("Mark winner 1 as claimed"))
    expect(await view.findByText("Marked as claimed.")).toBeTruthy()
    expect(requests.at(-1)).toEqual({
      route: "POST /api/dash/giveaways/gid-1/claim",
      body: { n: 0 },
    })
  })

  it("offers no manual claim while chat claim works", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Waiting to claim")

    expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
    expect(view.queryByLabelText("Mark winner 1 as claimed")).toBeNull()
  })

  it("closes entries", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByText("Close entries"))

    expect(await view.findByText("Entries closed.")).toBeTruthy()
    expect(requests.at(-1)?.route).toBe("POST /api/dash/giveaways/gid-1/close")
  })

  it("draws the chosen number of winners from closed entries", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ok({ kind: "drawn", winners: [0, 1] }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("Number of winners"), { target: { value: "2" } })
    fireEvent.click(view.getByText("Draw winners"))

    expect(await view.findByText("Winners drawn.")).toBeTruthy()
    expect(requests.at(-1)?.body).toEqual({ count: 2 })
  })

  it("rerolls a winner and says when the server refuses", async () => {
    mockFetch({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ({
        status: 409,
        body: { kind: "no-entrants-left" },
      }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByLabelText("Reroll winner 1"))

    expect(await view.findByText("No entrants are left to pick.")).toBeTruthy()
  })

  it("asks for a sign-in without a session", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Sign in with Twitch")).toBeTruthy()
  })

  it("answers not found for the giveaway of another streamer", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Giveaway not found")).toBeTruthy()
  })

  it("reconnects after the socket drops and says so meanwhile", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    act(() => FakeSocket.opened[0]?.drop())

    expect(await view.findByText("Reconnecting to the live feed…")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(0) + 200))
    expect(FakeSocket.opened.length).toBe(2)
  })

  it("ignores a push that is not a snapshot", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    act(() => FakeSocket.opened[0]?.push({ nonsense: true }))

    expect(view.getByText("Ada")).toBeTruthy()
  })
})

describe("reconnect delay", () => {
  it("doubles from one second and stops at the cap", () => {
    expect([0, 1, 2, 5, 6, 50].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 30_000, 30_000, 30_000,
    ])
  })
})
