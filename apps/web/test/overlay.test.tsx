import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import { act, cleanup } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { encode } from "uqr"
import { shareUrl } from "../src/lib/links.ts"
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
    {
      n: 0,
      entrySeq: 1,
      displayName: "Bob",
      claimUntil: 1,
      claim: { state: "claimed", via: "chat" },
    },
  ],
}

function routeSnapshot(snapshot: LiveSnapshot) {
  mockFetch({ "GET /api/overlay/gid-1/tok-1": () => ok(snapshot) })
}

it("shows the live view read-only on the overlay socket without a session", async () => {
  mockFetch({
    "GET /api/overlay/gid-1/tok-1": () =>
      ok({ ...liveSnapshot, chatClaimUnavailable: true, roleRefreshFailures: 3 }),
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Ada")).toBeTruthy()
  expect(view.getByText("Summer giveaway")).toBeTruthy()
  expect(view.getByText("ABCDE")).toBeTruthy()
  expect(view.getByText("people entered")).toBeTruthy()
  expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/overlay/gid-1/tok-1")
  act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 11 }))
  expect(await view.findByText("11")).toBeTruthy()
  expect(view.queryAllByRole("button")).toHaveLength(0)
  expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
  expect(view.queryByText(/Chat watch is off/)).toBeNull()
  expect(view.queryByRole("heading", { name: "Problems" })).toBeNull()
  expect(document.documentElement.dataset.surface).toBe("overlay")
})

it("names the giveaway by its code when the title is missing", async () => {
  mockFetch({ "GET /api/overlay/gid-1/tok-1": () => ok({ ...liveSnapshot, title: null }) })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByRole("heading", { level: 1, name: "Giveaway ABCDE" })).toBeTruthy()
})

it("shows the winner on a plate after a draw", async () => {
  routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.container.querySelectorAll(".winner-plate")).toHaveLength(1)
  expect(view.queryByText("people entered")).toBeNull()
})

it("keeps a replaced winner off the overlay", async () => {
  routeSnapshot({
    ...drawn,
    winners: [
      { n: 0, entrySeq: 1, displayName: "Bob", claimUntil: 1, claim: { state: "rerolled" } },
      { n: 1, entrySeq: 2, displayName: "Cy", claimUntil: 1, claim: { state: "waiting" } },
    ],
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Cy")).toBeTruthy()
  expect(view.queryByText("Bob")).toBeNull()
})

it("shows the code, the count and the newest names in compact mode while open", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=compact")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.getByText("3")).toBeTruthy()
  expect(view.getByText("Ada")).toBeTruthy()
  expect(view.container.querySelector(".winner-plate")).toBeNull()
})

it("says the entries are closed on the chip once they close", async () => {
  routeSnapshot({ ...liveSnapshot, status: "closed" })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Entries closed")).toBeTruthy()
  expect(view.queryByText("Enter at")).toBeNull()
})

it("treats an unknown mode like auto", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=sideways")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.getByText("Ada")).toBeTruthy()
})

it("shows only the winner plate in winner mode after a draw", async () => {
  routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1?mode=winner&qr=1")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.queryByText("ABCDE")).toBeNull()
  expect(view.queryByRole("img")).toBeNull()
})

it("shows nothing before a draw in winner mode", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=winner&qr=1")

  expect(await view.findByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
  expect(view.queryByText("Ada")).toBeNull()
  expect(view.queryByText("ABCDE")).toBeNull()
  expect(view.queryByText("people entered")).toBeNull()
  expect(view.queryByRole("img")).toBeNull()
  expect(view.container.querySelector(".winner-plate")).toBeNull()
})

it("draws a QR code of the viewer link beside the code with qr=1", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?qr=1")

  const qr = await view.findByRole("img", { name: "QR code with the link to enter the giveaway" })
  const { data, size } = encode(shareUrl("ABCDE"), { ecc: "M", border: 4 })
  expect(qr.getAttribute("viewBox")).toBe(`0 0 ${size} ${size}`)
  const dark = [...qr.querySelectorAll("rect")].map(
    (rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`,
  )
  const expected = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`${x},${y}`] : [])))
  expect(dark).toEqual(expected)
  expect(qr.querySelector("[style]")).toBeNull()
})

it("draws no QR code unless qr is 1", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?qr=true")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.queryByRole("img")).toBeNull()
})

it("draws no QR code on the winner plate after a draw", async () => {
  routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1?qr=1")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.queryByRole("img")).toBeNull()
})

it("shows not found for an invalid token and opens no socket", async () => {
  mockFetch({ "GET /api/overlay/gid-1/bad": () => ({ status: 404, body: { error: "not-found" } }) })

  const view = renderApp("/overlay/gid-1/bad")

  expect(await view.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy()
  expect(view.queryAllByRole("link")).toHaveLength(0)
  expect(FakeSocket.opened).toHaveLength(0)
})
