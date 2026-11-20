import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const giveawayRoutes = {
  "GET /api/g/ABCDE": () => ok(giveaway),
}

describe("sign-in error card", () => {
  it("says the viewer cancelled and offers the viewer sign-in of this giveaway again", async () => {
    mockFetch(giveawayRoutes)

    const view = renderApp("/g/ABCDE?error=access_denied")

    expect(await view.findByRole("heading", { name: "Sign-in with Twitch failed" })).toBeTruthy()
    expect(view.getByText("You cancelled the Twitch sign-in.")).toBeTruthy()
    expect(view.queryByText(/Error code/)).toBeNull()
    expect(view.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/auth/twitch/viewer/start?giveaway=ABCDE",
    )
  })

  it("explains a redirect mismatch to the operator and links the setup steps", async () => {
    mockFetch({})

    const view = renderApp(
      "/?error=redirect_mismatch&error_description=The+provided+redirect_uri+does+not+match&state=s&nonce=n",
    )

    expect(
      await view.findByText(/not set up correctly in the Twitch developer console/),
    ).toBeTruthy()
    expect(
      view.getByRole("link", { name: "See the Twitch app setup steps" }).getAttribute("href"),
    ).toContain("#twitch-app-registration")
    expect(view.queryByText(/does not match/)).toBeNull()
    expect(view.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/auth/twitch/streamer/start",
    )
  })

  it("shows an unknown error generically with its code and never renders markup from the query", async () => {
    mockFetch({})

    const view = renderApp("/?error=server_error&error_description=%3Cb%3Eboom%3C%2Fb%3E")

    expect(await view.findByText("Twitch could not sign you in.")).toBeTruthy()
    expect(view.getByText("Error code: server_error")).toBeTruthy()
    expect(view.container.querySelector("b")).toBeNull()
    expect(view.queryByText(/boom/)).toBeNull()
  })

  it("sends a streamer page to the streamer sign-in", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard?error=access_denied")

    expect((await view.findByRole("link", { name: "Try again" })).getAttribute("href")).toBe(
      "/auth/twitch/streamer/start",
    )
  })

  it("removes the error from the URL when dismissed and keeps the page", async () => {
    mockFetch(giveawayRoutes)

    const view = renderApp("/g/ABCDE?error=access_denied&error_description=x&state=s&entry=closed")
    fireEvent.click(await view.findByRole("button", { name: "Dismiss" }))

    expect(view.queryByRole("heading", { name: "Sign-in with Twitch failed" })).toBeNull()
    expect(await view.findByRole("heading", { name: "A gaming chair" })).toBeTruthy()
  })

  it("shows no card without an error in the query", async () => {
    mockFetch(giveawayRoutes)

    const view = renderApp("/g/ABCDE")

    await view.findByRole("heading", { name: "A gaming chair" })
    expect(view.queryByRole("heading", { name: "Sign-in with Twitch failed" })).toBeNull()
  })
})
