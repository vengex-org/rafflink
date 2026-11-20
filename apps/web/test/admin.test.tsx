import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup } from "@testing-library/react"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const queue = { queued: 7, ratePerSecond: 10, cooldownUntil: 0, dropped: 2, abandonedResults: 1 }
const quota = (used: number, limit: number) => ({ used, limit })

describe("admin page", () => {
  it("shows the usage against the limits and the queue counters", async () => {
    mockFetch({
      "GET /api/admin/usage": () =>
        ok({
          usage: { workerRequests: quota(40_000, 100_000), doRequests: quota(5, 100_000) },
          queue,
        }),
    })

    const view = renderApp("/admin")

    expect(await view.findByText("40000 of 100000")).toBeTruthy()
    expect(view.getByText("5 of 100000")).toBeTruthy()
    expect(view.getByText("7")).toBeTruthy()
    expect(view.getByText("none")).toBeTruthy()
  })

  it("says unavailable when the usage source did not answer", async () => {
    mockFetch({ "GET /api/admin/usage": () => ok({ usage: "unavailable", queue }) })

    const view = renderApp("/admin")

    expect(await view.findByText("unavailable")).toBeTruthy()
    expect(view.getByText("7")).toBeTruthy()
  })

  it("says no daily limit when the target has none", async () => {
    mockFetch({ "GET /api/admin/usage": () => ok({ usage: null, queue }) })

    const view = renderApp("/admin")

    expect(await view.findByText("no daily limit")).toBeTruthy()
  })

  it("refuses a signed-in streamer who is not an admin", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 403, body: { error: "forbidden" } }) })

    const view = renderApp("/admin")

    expect(await view.findByText("This Twitch account is not an admin.")).toBeTruthy()
  })

  it("asks for a sign-in without a session", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/admin")

    expect(await view.findByText("Sign in with Twitch")).toBeTruthy()
  })
})
