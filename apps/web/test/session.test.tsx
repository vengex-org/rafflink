import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { installFakeSocket } from "./fake-socket.ts"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const signedIn = {
  "GET /api/session": () => ok({ streamer: { displayName: "Streamy", login: "streamy" } }),
}

describe("header session", () => {
  it("shows the streamer's name linking to the dashboard and a Log out button", async () => {
    mockFetch(signedIn)

    const view = renderApp("/")

    const name = await view.findByRole("link", { name: "Streamy" })
    expect(name.getAttribute("href")).toBe("/dashboard")
    expect(view.getByRole("button", { name: "Log out" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "Log in" })).toBeNull()
  })

  it("shows Log in when nobody is signed in", async () => {
    mockFetch({})

    const view = renderApp("/")

    await waitFor(() => expect(view.getByRole("link", { name: "Log in" })).toBeTruthy())
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
  })

  it("shows Log in and logs the failure when the session call fails", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    mockFetch({ "GET /api/session": () => ({ status: 500, body: { error: "unavailable" } }) })

    const view = renderApp("/")

    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith("load failed", { errorClass: "ApiError", round: 0 }),
    )
    expect(view.getByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
  })

  it("posts the logout, goes home and shows Log in again", async () => {
    let signedInNow = true
    const requests = mockFetch({
      "GET /api/session": () =>
        ok({ streamer: signedInNow ? { displayName: "Streamy", login: "streamy" } : null }),
      "POST /auth/logout": () => {
        signedInNow = false
        return { status: 204, body: null }
      },
      "GET /api/dash/giveaways": () => ok({ giveaways: [] }),
    })
    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("button", { name: "Log out" }))

    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
    expect(
      await view.findByRole("heading", { level: 1, name: /Fair Twitch giveaways/ }),
    ).toBeTruthy()
    expect(requests.map((request) => request.route)).toContain("POST /auth/logout")
  })

  it("shows Log in after the logout even when a later session call would fail", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return sessionCalls === 1
          ? ok({ streamer: { displayName: "Streamy", login: "streamy" } })
          : { status: 500, body: { error: "unavailable" } }
      },
      "POST /auth/logout": () => ({ status: 204, body: null }),
    })
    const view = renderApp("/")
    fireEvent.click(await view.findByRole("button", { name: "Log out" }))

    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "Streamy" })).toBeNull()
    expect(sessionCalls).toBe(1)
    expect(logged).not.toHaveBeenCalled()
  })

  it("asks for the session on the streamer's pages only, not on a giveaway page", async () => {
    const restoreSocket = installFakeSocket()
    const requests = mockFetch({ "GET /api/g/ABCDE": () => ok(giveaway) })

    const view = renderApp("/ABCDE")
    await view.findByRole("heading", { level: 1 })

    expect(view.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/dashboard")
    expect(requests.map((request) => request.route)).toEqual(["GET /api/g/ABCDE"])
    restoreSocket()
  })

  it("keeps the name and logs when the logout fails", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    mockFetch({
      ...signedIn,
      "POST /auth/logout": () => ({ status: 403, body: { error: "forbidden" } }),
    })
    const view = renderApp("/")
    fireEvent.click(await view.findByRole("button", { name: "Log out" }))

    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith("action failed", { errorClass: "ApiError" }),
    )
    expect(view.getByRole("link", { name: "Streamy" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Log out" })).toBeTruthy()
    expect(await view.findByText("Something went wrong. Try again.")).toBeTruthy()
  })

  it("shows Log in when a dashboard call answers 401 after the session expired", async () => {
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return ok({
          streamer: sessionCalls === 1 ? { displayName: "Streamy", login: "streamy" } : null,
        })
      },
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "Streamy" })).toBeNull()
    expect(sessionCalls).toBe(2)
  })

  it("does not ask for the session again when the session call itself answers 401", async () => {
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return { status: 401, body: { error: "unauthorized" } }
      },
    })
    const logged = spyOn(console, "error").mockImplementation(() => {})

    const view = renderApp("/")

    await waitFor(() => expect(logged).toHaveBeenCalled())
    expect(view.getByRole("link", { name: "Log in" })).toBeTruthy()
    expect(sessionCalls).toBe(1)
  })
})
