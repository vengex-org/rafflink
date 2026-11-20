import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import { act, cleanup } from "@testing-library/react"
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

it("shows the live view read-only on the overlay socket without a session", async () => {
  mockFetch({
    "GET /api/overlay/gid-1/tok-1": () =>
      ok({ ...liveSnapshot, chatClaimUnavailable: true, roleRefreshFailures: 3 }),
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Ada")).toBeTruthy()
  expect(view.getByText("Summer giveaway")).toBeTruthy()
  expect(view.getByText(/Code ABCDE/)).toBeTruthy()
  expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/overlay/gid-1/tok-1")
  act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 11 }))
  expect(await view.findByText("11")).toBeTruthy()
  expect(view.queryAllByRole("button")).toHaveLength(0)
  expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
  expect(view.queryByText("Role refresh failures")).toBeNull()
  expect(document.documentElement.dataset.surface).toBe("overlay")
})

it("shows not found for an invalid token and opens no socket", async () => {
  mockFetch({ "GET /api/overlay/gid-1/bad": () => ({ status: 404, body: { error: "not-found" } }) })

  const view = renderApp("/overlay/gid-1/bad")

  expect(await view.findByText("Not found")).toBeTruthy()
  expect(FakeSocket.opened).toHaveLength(0)
})
