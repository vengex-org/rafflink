import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import {
  jitteredReconnectDelayMs,
  maxViewerSocketFailures,
  minViewerSocketGiveUpMs,
} from "../src/lib/use-viewer-push.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { claimedAt, claimedAtText, giveaway } from "./fixtures.ts"
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

const entry = { group: "viewer", tickets: 1, enteredAt: 1 }
const enteredAsU1 = { kind: "entered", userId: "u1", entry }
const pageRoute = (me: unknown = enteredAsU1) => ({
  "GET /api/g/ABCDE": () => ok({ ...giveaway, me }),
})

function push(overrides: Partial<ViewerPush> = {}): ViewerPush {
  return {
    status: "open",
    finished: false,
    chatClaimAvailable: true,
    winners: [],
    now: Date.now(),
    ...overrides,
  }
}

const waitingWinner = (platformUserId: string, n = 0) => ({
  n,
  platformUserId,
  claimUntil: Date.now() + 120_000,
  claim: { state: "waiting" as const },
})

// The socket opens in an effect, which can run after the page's text is on screen.
function connected(): Promise<FakeSocket> {
  return waitFor(() => {
    const socket = FakeSocket.opened[0]
    if (socket === undefined) throw new Error("the page has not opened its socket")
    return socket
  })
}

function freezeClock(): { now: number } {
  const clock = { now: 1_000_000 }
  spyOn(Date, "now").mockImplementation(() => clock.now)
  return clock
}

async function pageWithSocket(): Promise<void> {
  spyOn(Math, "random").mockReturnValue(0)
  spyOn(console, "warn").mockImplementation(() => {})
  mockFetch(pageRoute())
  const view = renderApp("/ABCDE")
  await view.findByRole("heading", { name: "You are in" })
}

/** Drops the socket the page opened as number `attempt` (from 1) before any message arrived. */
async function dropAttempt(attempt: number): Promise<void> {
  await waitFor(() => expect(FakeSocket.opened).toHaveLength(attempt))
  act(() => FakeSocket.opened[attempt - 1]?.drop())
}

function showAs(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true })
}

async function giveUp(clock: { now: number }): Promise<void> {
  await pageWithSocket()
  for (let attempt = 1; attempt < maxViewerSocketFailures; attempt++) await dropAttempt(attempt)
  clock.now += minViewerSocketGiveUpMs
  await dropAttempt(maxViewerSocketFailures)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

const pageLoads = (requests: readonly { readonly route: string }[]) =>
  requests.filter((request) => request.route === "GET /api/g/ABCDE").length

describe("viewer page: push", () => {
  it("opens the viewer socket on the page's own origin and sends nothing", async () => {
    mockFetch(pageRoute())

    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    await connected()

    expect(FakeSocket.opened.map((socket) => socket.url)).toEqual([
      "ws://rafflink.test/api/g/ABCDE/live",
    ])
    expect(Reflect.has(FakeSocket.opened[0] ?? {}, "send")).toBe(false)
  })

  it("shows You won when a push names the viewer, without another request", async () => {
    const requests = mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() =>
      socket.push(
        push({
          status: "drawn",
          winners: [waitingWinner("someone-else", 0), waitingWinner("u1", 1)],
        }),
      ),
    )

    expect(await view.findByRole("heading", { name: "You won" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
    expect(pageLoads(requests)).toBe(1)
  })

  it("keeps the entry the page knew when a push turns the viewer into a winner", async () => {
    mockFetch(pageRoute({ ...enteredAsU1, entry: { group: "vip", tickets: 6, enteredAt: 1 } }))
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1")] })))

    expect(await view.findByText("Your entry: 6 tickets as a VIP.")).toBeTruthy()
  })

  it("keeps the tickets of a viewer the page loaded as a winner when a later push arrives", async () => {
    mockFetch(
      pageRoute({
        kind: "won",
        userId: "u1",
        n: 0,
        entry: { tickets: 2, group: "moderator" },
        claimRemainingMs: 90_000,
        claim: { state: "waiting" },
        chatClaimAvailable: true,
      }),
    )
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You won" })

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1")] })))

    await view.findByRole("button", { name: "Claim my prize" })
    expect(view.getByText("Your entry: 2 tickets as a moderator.")).toBeTruthy()
  })

  it("shows a reroll winner the page held as not-won the win from the push alone, without a ticket box", async () => {
    const requests = mockFetch(pageRoute({ kind: "not-won", userId: "u1" }))
    const view = renderApp("/ABCDE")
    await view.findByText("The winner was drawn. It was not you this time.")

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1", 1)] })))

    expect(await view.findByRole("heading", { name: "You won" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
    expect(view.queryByText(/Your entry:/)).toBeNull()
    expect(pageLoads(requests)).toBe(1)
  })

  it("shows a claimed reroll winner the claim time without a ticket box", async () => {
    mockFetch(pageRoute({ kind: "not-won", userId: "u1" }))
    const view = renderApp("/ABCDE")
    await view.findByText("The winner was drawn. It was not you this time.")

    const socket = await connected()
    const claimed = {
      ...waitingWinner("u1", 1),
      claim: { state: "claimed" as const, at: claimedAt, via: "chat" as const },
    }
    act(() => socket.push(push({ status: "drawn", winners: [claimed] })))

    expect(await view.findByText(`Claimed on ${claimedAtText}.`)).toBeTruthy()
    expect(view.queryByText(/Your entry:/)).toBeNull()
  })

  it("says it was not them when the winners are other users", async () => {
    const requests = mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u2")] })))

    expect(await view.findByText("The winner was drawn. It was not you this time.")).toBeTruthy()
    expect(pageLoads(requests)).toBe(1)
  })

  it("shows Claimed when a later push says the winner's claim went through", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1")] })))
    await view.findByRole("button", { name: "Claim my prize" })

    act(() =>
      socket.push(
        push({
          status: "drawn",
          winners: [{ ...waitingWinner("u1"), claim: { state: "claimed", at: 1, via: "chat" } }],
        }),
      ),
    )

    expect(await view.findByText("Claimed! The streamer will contact you.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
  })

  it("tells a winner whose pick was replaced", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() =>
      socket.push(
        push({
          status: "drawn",
          winners: [{ ...waitingWinner("u1"), claim: { state: "rerolled" } }],
        }),
      ),
    )

    expect(await view.findByText("The streamer picked another winner.")).toBeTruthy()
  })

  it("shows the closed card when a push says entries closed", async () => {
    mockFetch(pageRoute({ kind: "signed-out" }))
    const view = renderApp("/ABCDE")
    await view.findByRole("link", { name: "Enter with Twitch" })

    const socket = await connected()
    act(() => socket.push(push({ status: "closed" })))

    expect(await view.findByText(/giveaway closed/)).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("keeps a signed-out viewer on the sign-in prompt after the draw", async () => {
    mockFetch(pageRoute({ kind: "signed-out" }))
    const view = renderApp("/ABCDE")
    await view.findByRole("link", { name: "Enter with Twitch" })

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1")] })))

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("ignores a message that is not a viewer push", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() => socket.push({ nonsense: true }))

    expect(view.getByRole("heading", { name: "You are in" })).toBeTruthy()
  })

  it("keeps listening after the last claim time ran out, so a reroll still reaches the page", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    const socket = await connected()
    const expired = { ...waitingWinner("u1"), claim: { state: "expired" as const } }
    act(() => socket.push(push({ status: "drawn", finished: false, winners: [expired] })))
    await view.findByRole("heading", { name: "Time is up" })

    act(() =>
      socket.push(
        push({
          status: "drawn",
          finished: false,
          winners: [{ ...expired, claim: { state: "rerolled" } }, waitingWinner("u2", 1)],
        }),
      ),
    )

    expect(socket.closed).toBe(false)
    expect(await view.findByText("The streamer picked another winner.")).toBeTruthy()
  })

  it("changes nothing on screen when the same push arrives twice", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    const socket = await connected()
    const claimed = push({
      status: "drawn",
      winners: [{ ...waitingWinner("u1"), claim: { state: "claimed", at: 1, via: "chat" } }],
    })
    act(() => socket.push(claimed))
    await view.findByText("Claimed! The streamer will contact you.")
    const shown = view.container.innerHTML

    act(() => socket.push(claimed))

    expect(view.container.innerHTML).toBe(shown)
  })

  it("opens no socket for a giveaway that is already finished", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({ ...giveaway, status: "drawn", finished: true, me: { kind: "signed-out" } }),
    })

    const view = renderApp("/ABCDE")
    await view.findByRole("link", { name: "Sign in with Twitch" })
    // Effects of the first render have run by then, so a socket that should not open would have.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(FakeSocket.opened).toEqual([])
  })
})

describe("viewer page: reconnect", () => {
  it("reconnects after the socket drops", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() => socket.drop())

    await new Promise((resolve) => setTimeout(resolve, jitteredReconnectDelayMs(0, 0) + 200))
    expect(FakeSocket.opened).toHaveLength(2)
  })

  it("does not reconnect once a push said the giveaway is finished", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    const socket = await connected()
    act(() => socket.push(push({ status: "drawn", finished: true })))
    act(() => socket.drop())

    await new Promise((resolve) => setTimeout(resolve, jitteredReconnectDelayMs(0, 0) + 200))
    expect(FakeSocket.opened[0]?.closed).toBe(true)
    expect(FakeSocket.opened).toHaveLength(1)
  })

  it("spreads the delay over zero to the whole backoff so viewers do not reconnect together", () => {
    expect([0, 0.5, 0.999].map((random) => jitteredReconnectDelayMs(2, random))).toEqual([
      0, 2000, 3996,
    ])
  })

  it("stops after the failure cap and the minimum time in a row, because a refused socket never recovers", async () => {
    const clock = freezeClock()
    await pageWithSocket()

    for (let attempt = 1; attempt < maxViewerSocketFailures; attempt++) {
      await dropAttempt(attempt)
    }
    clock.now += minViewerSocketGiveUpMs
    await dropAttempt(maxViewerSocketFailures)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures)
  })

  it("keeps trying past the failure cap while the minimum time has not passed, so a network switch does not end the push", async () => {
    const clock = freezeClock()
    await pageWithSocket()

    for (let attempt = 1; attempt <= maxViewerSocketFailures + 1; attempt++) {
      await dropAttempt(attempt)
      clock.now += minViewerSocketGiveUpMs / (maxViewerSocketFailures + 2)
    }

    await waitFor(() => expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 2))
  })

  it("does not count a connection that opened but sent nothing as healthy, so an accept-then-close server ends the loop", async () => {
    const clock = freezeClock()
    await pageWithSocket()

    for (let attempt = 1; attempt <= maxViewerSocketFailures; attempt++) {
      await waitFor(() => expect(FakeSocket.opened).toHaveLength(attempt))
      act(() => FakeSocket.opened[attempt - 1]?.open())
      clock.now += minViewerSocketGiveUpMs
      act(() => FakeSocket.opened[attempt - 1]?.drop())
    }
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures)
  })

  it("keeps reconnecting while the connections deliver a message before they drop", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    const drops = maxViewerSocketFailures + 2

    for (let attempt = 1; attempt <= drops; attempt++) {
      await waitFor(() => expect(FakeSocket.opened).toHaveLength(attempt))
      act(() => FakeSocket.opened[attempt - 1]?.push(push()))
      act(() => FakeSocket.opened[attempt - 1]?.drop())
    }

    await waitFor(() => expect(FakeSocket.opened).toHaveLength(drops + 1))
  })

  it("counts only the failures in a row: a connection that delivered a message starts the count again", async () => {
    const clock = freezeClock()
    await pageWithSocket()

    for (let attempt = 1; attempt < maxViewerSocketFailures; attempt++) {
      await dropAttempt(attempt)
    }
    await waitFor(() => expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures))
    act(() => FakeSocket.opened[maxViewerSocketFailures - 1]?.push(push()))
    clock.now += minViewerSocketGiveUpMs
    act(() => FakeSocket.opened[maxViewerSocketFailures - 1]?.drop())
    for (
      let attempt = maxViewerSocketFailures + 1;
      attempt < 2 * maxViewerSocketFailures;
      attempt++
    ) {
      await dropAttempt(attempt)
    }
    clock.now += minViewerSocketGiveUpMs
    await dropAttempt(2 * maxViewerSocketFailures)

    await waitFor(() => expect(FakeSocket.opened).toHaveLength(2 * maxViewerSocketFailures))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(FakeSocket.opened).toHaveLength(2 * maxViewerSocketFailures)
  })

  it("tries again once when the browser comes back online after giving up, with a fresh streak", async () => {
    const clock = freezeClock()
    await giveUp(clock)

    act(() => {
      window.dispatchEvent(new Event("online"))
      window.dispatchEvent(new Event("online"))
    })
    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 1)

    await dropAttempt(maxViewerSocketFailures + 1)
    await waitFor(() => expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 2))
  })

  it("tries again when the tab becomes visible after giving up, and not while it is hidden", async () => {
    const clock = freezeClock()
    await giveUp(clock)

    showAs("hidden")
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures)

    showAs("visible")
    clock.now += minViewerSocketGiveUpMs
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 1)
  })

  it("waits out the rest of the minimum time when the tab becomes visible too soon after giving up", async () => {
    const clock = freezeClock()
    await giveUp(clock)

    clock.now += minViewerSocketGiveUpMs - 30
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures)

    await waitFor(() => expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures + 1)
  })

  it("does not open a socket on online while it is still connected", async () => {
    mockFetch(pageRoute())
    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })
    await connected()

    act(() => window.dispatchEvent(new Event("online")))

    expect(FakeSocket.opened).toHaveLength(1)
  })
})

describe("viewer page: reload window", () => {
  it("renders a reload inside the window from the stored answer and opens only the socket", async () => {
    const requests = mockFetch(pageRoute())
    const first = renderApp("/ABCDE")
    await first.findByRole("heading", { name: "You are in" })
    cleanup()

    const second = renderApp("/ABCDE")

    expect(await second.findByRole("heading", { name: "You are in" })).toBeTruthy()
    await waitFor(() => expect(FakeSocket.opened).toHaveLength(2))
    expect(pageLoads(requests)).toBe(1)
  })

  it("fetches again when the stored answer is older than the window", async () => {
    const requests = mockFetch(pageRoute())
    const first = renderApp("/ABCDE")
    await first.findByRole("heading", { name: "You are in" })
    cleanup()
    const realNow = Date.now()
    spyOn(Date, "now").mockReturnValue(realNow + 30_001)

    const second = renderApp("/ABCDE")
    await second.findByRole("heading", { name: "You are in" })

    expect(pageLoads(requests)).toBe(2)
  })

  it("still uses the stored answer just inside the window", async () => {
    const requests = mockFetch(pageRoute())
    const first = renderApp("/ABCDE")
    await first.findByRole("heading", { name: "You are in" })
    cleanup()
    const realNow = Date.now()
    spyOn(Date, "now").mockReturnValue(realNow + 29_000)

    const second = renderApp("/ABCDE")
    await second.findByRole("heading", { name: "You are in" })

    expect(pageLoads(requests)).toBe(1)
  })

  it("fetches when the page comes back from the sign-in with an entry outcome", async () => {
    const requests = mockFetch(pageRoute({ kind: "signed-out" }))
    const first = renderApp("/ABCDE")
    await first.findByRole("link", { name: "Enter with Twitch" })
    cleanup()

    const second = renderApp("/ABCDE?entry=entered")
    await second.findByRole("heading", { name: "You are in" })

    expect(pageLoads(requests)).toBe(2)
  })

  it("fetches after a queued entry settled, because the viewer changed", async () => {
    const requests = mockFetch({
      ...pageRoute({ kind: "signed-out" }),
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "entered", entry }),
    })
    const first = renderApp("/ABCDE?entry=pending&ticket=T1")
    await first.findByRole("heading", { name: "You are in" })
    cleanup()

    const second = renderApp("/ABCDE")
    await second.findByRole("link", { name: "Enter with Twitch" })

    expect(pageLoads(requests)).toBe(2)
  })

  it("knows the viewer after a queued entry settled, so a pushed draw shows the claim panel", async () => {
    let loads = 0
    const requests = mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({ ...giveaway, me: ++loads === 1 ? { kind: "signed-out" } : enteredAsU1 }),
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "entered", entry }),
    })
    const view = renderApp("/ABCDE?entry=pending&ticket=T1")
    await view.findByRole("heading", { name: "You are in" })
    await waitFor(() => expect(pageLoads(requests)).toBe(2))
    const socket = await connected()

    act(() => socket.push(push({ status: "drawn", winners: [waitingWinner("u1")] })))

    expect(await view.findByRole("button", { name: "Claim my prize" })).toBeTruthy()
    expect(pageLoads(requests)).toBe(2)
  })

  it("does not ask again when a queued entry settled as not eligible", async () => {
    const requests = mockFetch({
      ...pageRoute({ kind: "signed-out" }),
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "not-eligible", reason: "followers-only" }),
    })
    const view = renderApp("/ABCDE?entry=pending&ticket=T1")
    await view.findByRole("heading", { name: "You cannot enter" })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(pageLoads(requests)).toBe(1)
  })

  it("fetches after the viewer claimed", async () => {
    const requests = mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          me: {
            kind: "won",
            userId: "u1",
            n: 0,
            entry: { tickets: 3, group: "follower" },
            claimRemainingMs: 90_000,
            claim: { state: "waiting" },
            chatClaimAvailable: true,
          },
        }),
      "POST /api/g/ABCDE/claim": () => ok({ kind: "claimed" }),
    })
    const first = renderApp("/ABCDE")
    fireEvent.click(await first.findByRole("button", { name: "Claim my prize" }))
    await first.findByText("Claimed! The streamer will contact you.")
    cleanup()

    const second = renderApp("/ABCDE")
    await second.findByRole("button", { name: "Claim my prize" })

    expect(pageLoads(requests)).toBe(2)
  })

  it("takes the claim time that already passed since the stored answer off the clock", async () => {
    const stored = {
      ...giveaway,
      status: "drawn",
      me: {
        kind: "won",
        userId: "u1",
        n: 0,
        entry: { tickets: 3, group: "follower" },
        claimRemainingMs: 90_000,
        claim: { state: "waiting" },
        chatClaimAvailable: true,
      },
    }
    window.sessionStorage.setItem(
      "rafflink:giveaway:ABCDE",
      JSON.stringify({ at: Date.now() - 20_000, load: JSON.stringify(stored) }),
    )
    const requests = mockFetch({})

    const view = renderApp("/ABCDE")

    expect((await view.findByRole("timer")).textContent).toMatch(/^1:(09|10)$/)
    expect(pageLoads(requests)).toBe(0)
  })

  it.each([
    ["is not JSON", "{"],
    ["has no time", JSON.stringify({ load: "{}" })],
    ["holds a body of the wrong shape", JSON.stringify({ at: Date.now(), load: "{}" })],
    ["is from the future", JSON.stringify({ at: Date.now() + 60_000, load: "{}" })],
  ])("fetches when the stored answer %s", async (_name, raw) => {
    window.sessionStorage.setItem("rafflink:giveaway:ABCDE", raw)
    const requests = mockFetch(pageRoute())

    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { name: "You are in" })

    expect(pageLoads(requests)).toBe(1)
  })

  it("works when the storage refuses writes", async () => {
    spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError")
    })
    mockFetch(pageRoute())

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
  })

  it("still shows a claim as claimed when the storage refuses to forget the stored answer", async () => {
    spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          me: {
            kind: "won",
            userId: "u1",
            n: 0,
            entry: { tickets: 3, group: "follower" },
            claimRemainingMs: 90_000,
            claim: { state: "waiting" },
            chatClaimAvailable: true,
          },
        }),
      "POST /api/g/ABCDE/claim": () => ok({ kind: "claimed" }),
    })
    const view = renderApp("/ABCDE")

    fireEvent.click(await view.findByRole("button", { name: "Claim my prize" }))

    expect(await view.findByText("Claimed! The streamer will contact you.")).toBeTruthy()
  })
})
