import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
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

    const view = renderApp("/ABCDE?error=access_denied&platform=twitch")

    expect(await view.findByRole("heading", { name: "Sign-in with Twitch failed" })).toBeTruthy()
    expect(view.getByText("You cancelled the Twitch sign-in.")).toBeTruthy()
    expect(view.queryByText(/Error code/)).toBeNull()
    const retry = view.getByRole("link", { name: "Try again" })
    expect(retry.getAttribute("href")).toBe("/auth/twitch/viewer/start?giveaway=ABCDE")
    expect(retry.hasAttribute("target")).toBe(false)
  })

  it("is as wide as the viewer card above a giveaway and a text column above any other page", async () => {
    mockFetch(giveawayRoutes)
    const onGiveaway = renderApp("/ABCDE?error=access_denied&platform=twitch")
    const giveawayCard = await onGiveaway.findByRole("heading", {
      name: "Sign-in with Twitch failed",
    })
    expect(giveawayCard.closest(".page")?.getAttribute("data-width")).toBe("compact")
    onGiveaway.unmount()

    const onHome = renderApp("/?error=access_denied&platform=twitch")
    const homeCard = await onHome.findByRole("heading", { name: "Sign-in with Twitch failed" })
    expect(homeCard.closest(".page")?.getAttribute("data-width")).toBe("text")
  })

  it("explains a redirect mismatch to the operator and links the setup steps", async () => {
    mockFetch({})

    const view = renderApp(
      "/?error=redirect_mismatch&platform=twitch&error_description=The+provided+redirect_uri+does+not+match&state=s&nonce=n",
    )

    expect(
      await view.findByText(/not set up correctly in the Twitch developer settings/),
    ).toBeTruthy()
    expect(
      view.getByRole("link", { name: "See the Twitch app setup steps" }).getAttribute("href"),
    ).toContain("docs/self-hosting.md#twitch-app-registration")
    const guide = view.getByRole("link", { name: "See the Twitch app setup steps" })
    expect(guide.getAttribute("target")).toBe("_blank")
    expect(guide.getAttribute("rel")).toBe("noopener")
    expect(view.queryByText(/does not match/)).toBeNull()
    expect(view.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/auth/twitch/streamer/start",
    )
  })

  it("shows an unknown error generically with its code and never renders markup from the query", async () => {
    mockFetch({})

    const view = renderApp(
      "/?error=server_error&platform=twitch&error_description=%3Cb%3Eboom%3C%2Fb%3E",
    )

    expect(await view.findByText("Twitch could not sign you in.")).toBeTruthy()
    expect(view.getByText("Error code: server_error")).toBeTruthy()
    expect(view.getByRole("alert").closest("section")?.querySelector("b")).toBeNull()
    expect(view.queryByText(/boom/)).toBeNull()
  })

  it("sends a streamer page to the streamer sign-in", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard?error=access_denied&platform=twitch")

    expect((await view.findByRole("link", { name: "Try again" })).getAttribute("href")).toBe(
      "/auth/twitch/streamer/start",
    )
  })

  it("names Kick and retries the Kick sign-in when Kick refused", async () => {
    mockFetch(giveawayRoutes)
    const streamer = renderApp("/?error=access_denied&platform=kick")
    expect(await streamer.findByRole("heading", { name: "Sign-in with Kick failed" })).toBeTruthy()
    expect(streamer.getByText("You cancelled the Kick sign-in.")).toBeTruthy()
    expect(streamer.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/auth/kick/streamer/start",
    )
    streamer.unmount()

    const viewer = renderApp("/ABCDE?error=redirect_mismatch&platform=kick")

    expect(
      await viewer.findByText(/not set up correctly in the Kick developer settings/),
    ).toBeTruthy()
    expect(
      viewer.getByRole("link", { name: "See the Kick app setup steps" }).getAttribute("href"),
    ).toContain("docs/self-hosting.md#kick-app-registration-optional")
    expect(viewer.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/auth/kick/viewer/start?giveaway=ABCDE",
    )
  })

  it("removes the error from the URL when dismissed and keeps the page", async () => {
    mockFetch(giveawayRoutes)

    const view = renderApp(
      "/ABCDE?error=access_denied&platform=twitch&error_description=x&state=s&entry=closed",
    )
    // The page removes the sign-in outcome from the address when it opens; dismissing starts from that address.
    await waitFor(() => expect(view.address()).not.toContain("entry="))
    fireEvent.click(await view.findByRole("button", { name: "Dismiss" }))

    await waitFor(() =>
      expect(view.queryByRole("heading", { name: "Sign-in with Twitch failed" })).toBeNull(),
    )
    expect(view.address()).toBe("/ABCDE")
    expect(await view.findByRole("heading", { name: "A gaming chair" })).toBeTruthy()
  })

  it("shows no card without an error or a known platform in the query", async () => {
    for (const path of [
      "/ABCDE",
      "/ABCDE?error=access_denied",
      "/ABCDE?error=access_denied&platform=x",
    ]) {
      mockFetch(giveawayRoutes)
      const view = renderApp(path)

      await view.findByRole("heading", { name: "A gaming chair" })
      expect(view.queryByRole("button", { name: "Dismiss" })).toBeNull()
      view.unmount()
    }
  })
})
