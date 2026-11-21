import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup } from "@testing-library/react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { giveaway, liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

const now = Date.UTC(2026, 10, 21, 12)
const sample = ["Ann", "Bo"]

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
  jest.useFakeTimers()
  jest.setSystemTime(now)
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
  jest.useRealTimers()
})

const pending: LiveSnapshot = {
  ...liveSnapshot,
  status: "closed",
  now,
  drawAvailableAt: now + 5000,
  drawRequested: true,
  shuffleNames: sample,
}

const winner = (n: number, name: string): LiveWinner => ({
  n,
  entrySeq: n + 1,
  displayName: name,
  profileImageUrl: null,
  claimUntil: now + 300_000,
  claim: { state: "waiting" },
})

const drawnWith = (...winners: LiveWinner[]): LiveSnapshot => ({
  ...liveSnapshot,
  status: "drawn",
  now,
  entrantCount: 9,
  winners,
  shuffleNames: sample,
  rerollOpen: true,
  rerollBlocked: null,
})

const surfaces = [
  {
    name: "live page",
    open: (snapshot: LiveSnapshot) => {
      mockFetch({
        "GET /api/g/ABCDE": () => ok(giveaway),
        "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
        "GET /api/live/gid-1": () => ok(snapshot),
      })
      return renderApp("/live/gid-1")
    },
  },
  {
    name: "overlay",
    open: (snapshot: LiveSnapshot) => {
      mockFetch({
        "GET /api/g/ABCDE": () => ok({ ...giveaway, prize: null }),
        "GET /api/overlay/gid-1/tok-1": () => ok(snapshot),
      })
      return renderApp("/overlay/gid-1/tok-1")
    },
  },
]

type View = ReturnType<typeof renderApp>
// The newest plate: the overlay lists every standing winner, the live page shows one.
const plateName = (view: View) =>
  [...view.container.querySelectorAll(".winner-plate-name")].at(-1)?.textContent
const shuffling = (view: View) => view.container.querySelector("[data-shuffling]") !== null
const push = (snapshot: LiveSnapshot) => act(() => FakeSocket.opened[0]?.push(snapshot))
const tick = (ms: number) => act(() => jest.advanceTimersByTime(ms))

describe.each(surfaces)("draw shuffle on the $name", ({ open }) => {
  it("flashes only the sampled names while the draw is pending", async () => {
    let calls = 0
    spyOn(Math, "random").mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.99))

    const view = open(pending)
    await view.findAllByText("Drawing the winner…")
    const seen = new Set<string | null | undefined>()
    for (let i = 0; i < 6; i++) {
      tick(90)
      seen.add(plateName(view))
    }

    expect(shuffling(view)).toBe(true)
    expect(seen).toEqual(new Set(sample))
  })

  it("keeps the pick back until the shuffle has run its minimum, then lands on the real winner", async () => {
    const view = open(pending)
    await view.findAllByText("Drawing the winner…")

    push(drawnWith(winner(0, "Wanda")))
    expect(plateName(view)).not.toBe("Wanda")
    expect(shuffling(view)).toBe(true)
    tick(1300)
    expect(plateName(view)).not.toBe("Wanda")
    tick(300)

    expect(plateName(view)).toBe("Wanda")
    expect(shuffling(view)).toBe(false)
  })

  it("shuffles again before every later pick, with the names it already has", async () => {
    const view = open(pending)
    await view.findAllByText("Drawing the winner…")
    push(drawnWith(winner(0, "Wanda")))
    tick(2000)
    expect(plateName(view)).toBe("Wanda")

    push(drawnWith(winner(0, "Wanda"), winner(1, "Cy")))
    expect(shuffling(view)).toBe(true)
    expect(sample).toContain(plateName(view) ?? "")
    tick(1400)
    expect(plateName(view)).not.toBe("Cy")
    tick(200)

    expect(plateName(view)).toBe("Cy")
    expect(shuffling(view)).toBe(false)
  })

  it("flashes the sampled names for a next draw on a page that opened drawn, then reveals the new winner", async () => {
    const view = open(drawnWith(winner(0, "Wanda")))
    await view.findAllByText("Winner 1 of 1")

    push(drawnWith(winner(0, "Wanda"), winner(1, "Cy")))
    expect(shuffling(view)).toBe(true)
    expect(sample).toContain(plateName(view) ?? "")
    tick(1400)
    expect(plateName(view)).not.toBe("Cy")
    tick(200)

    expect(plateName(view)).toBe("Cy")
    expect(shuffling(view)).toBe(false)
  })

  it("flashes the sampled names for a reroll on a page that opened drawn, then reveals the replacement", async () => {
    const view = open(drawnWith(winner(0, "Wanda")))
    await view.findAllByText("Winner 1 of 1")

    const rerolled: LiveWinner = { ...winner(0, "Wanda"), claim: { state: "rerolled" } }
    push(drawnWith(rerolled, winner(1, "Cy")))
    expect(shuffling(view)).toBe(true)
    expect(sample).toContain(plateName(view) ?? "")
    tick(1400)
    expect(plateName(view)).not.toBe("Cy")
    tick(200)

    expect(plateName(view)).toBe("Cy")
    expect(shuffling(view)).toBe(false)
  })

  it("does not shuffle a page that opens on a drawn giveaway", async () => {
    const view = open(drawnWith(winner(0, "Wanda")))

    await view.findAllByText("Winner 1 of 1")
    expect(plateName(view)).toBe("Wanda")
    expect(shuffling(view)).toBe(false)
  })

  it("shows a plain countdown and no flashing names under reduced motion", async () => {
    spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))

    const view = open(pending)
    await view.findAllByText("Drawing the winner…")
    expect(plateName(view)).toBe("0:05")
    tick(2000)

    expect(plateName(view)).toBe("0:03")
    expect(view.queryByText("Ann")).toBeNull()
    expect(view.queryByText("Bo")).toBeNull()
  })
})
