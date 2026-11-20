import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup } from "@testing-library/react"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const queue = {
  queued: 7,
  ratePerSecond: 10,
  cooldownUntil: 0,
  dropped: 2,
  abandonedResults: 1,
  lostClaims: 3,
}
const quota = (used: number, limit: number) => ({ used, limit })

describe("admin page", () => {
  it("shows the usage as bars with a sentence and the queue counters with labels", async () => {
    mockFetch({
      "GET /api/admin/usage": () =>
        ok({
          usage: { workerRequests: quota(62_000, 100_000), doRequests: quota(5, 100_000) },
          queue,
        }),
    })

    const view = renderApp("/admin")

    expect(await view.findByText("62,000 of 100,000 requests used today")).toBeTruthy()
    expect(view.getByText("5 of 100,000 requests used today")).toBeTruthy()
    const bar = view.getByRole("progressbar", { name: "Worker requests" })
    expect(bar.getAttribute("value")).toBe("62000")
    expect(bar.getAttribute("max")).toBe("100000")
    expect(view.getByText("7")).toBeTruthy()
    expect(view.getByText("entries waiting")).toBeTruthy()
    expect(view.getByText("none")).toBeTruthy()
    expect(view.getByText("3")).toBeTruthy()
    expect(view.getByText("entries processed twice, one result discarded")).toBeTruthy()
  })

  it("says the usage is unavailable when the usage source did not answer", async () => {
    mockFetch({ "GET /api/admin/usage": () => ok({ usage: "unavailable", queue }) })

    const view = renderApp("/admin")

    expect(await view.findByText("Today's usage is unavailable right now.")).toBeTruthy()
    expect(view.getByText("7")).toBeTruthy()
  })

  it("says there is no daily limit when the target has none", async () => {
    mockFetch({ "GET /api/admin/usage": () => ok({ usage: null, queue }) })

    const view = renderApp("/admin")

    expect(await view.findByText("This server has no daily request limit.")).toBeTruthy()
  })

  it("refuses a signed-in streamer who is not an admin", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 403, body: { error: "forbidden" } }) })

    const view = renderApp("/admin")

    expect(await view.findByText("This Twitch account is not an admin.")).toBeTruthy()
  })

  it("asks for a sign-in without a session", async () => {
    mockFetch({ "GET /api/admin/usage": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/admin")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })
})
