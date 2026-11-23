import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import { donateUrl, supportedSession, twitchPlatform } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

beforeEach(() => {
  mockFetch({})
})
afterEach(() => {
  cleanup()
  mock.restore()
  window.localStorage.clear()
})

describe("home page", () => {
  it("opens with the one-sentence promise as the only h1", () => {
    const view = renderApp("/")

    const headings = view.getAllByRole("heading", { level: 1 })

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Fair giveaways, drawn live on stream.",
    ])
  })

  it("starts with a skip link to the main landmark", () => {
    const view = renderApp("/")

    const skip = view.getAllByRole("link")[0]

    expect(skip?.textContent).toBe("Skip to content")
    expect(skip?.getAttribute("href")).toBe("#main")
    expect(view.getByRole("main").id).toBe("main")
  })

  it("links the log-in button to the sign-in target", () => {
    const view = renderApp("/")

    const login = view.getByRole("link", { name: "Sign in and start" })

    expect(login.getAttribute("href")).toBe("/dashboard")
  })

  it("offers My giveaways instead of logging in when the streamer is signed in, from one session call", async () => {
    const requests = mockFetch({
      "GET /api/session": () =>
        ok({
          streamer: {
            displayName: "Streamy",
            login: "streamy",
            profileImageUrl: null,
            canCreate: true,
            ...twitchPlatform,
          },
          signInPlatforms: ["twitch"],
          donateUrl: null,
          operator: null,
        }),
    })
    const view = renderApp("/")

    await view.findByRole("button", { name: "Streamy" })

    const cta = view.getByRole("link", { name: "My giveaways" })
    expect(cta.getAttribute("href")).toBe("/dashboard")
    expect(view.queryByRole("link", { name: "Sign in and start" })).toBeNull()
    expect(requests.filter((request) => request.route === "GET /api/session")).toHaveLength(1)
  })

  it("links the configured Ko-fi page in the footer for a signed-out visitor, opening in a new tab", async () => {
    mockFetch({
      "GET /api/session": () =>
        ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl, operator: null }),
    })
    const view = renderApp("/")

    const link = await view.findByRole("link", { name: "Support on Ko-fi" })

    expect(link.getAttribute("href")).toBe(donateUrl)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener nofollow")
    expect(link.closest(".home-footer")).not.toBeNull()
  })

  it("links the configured support page in the footer for a signed-in streamer", async () => {
    mockFetch({ "GET /api/session": () => ok(supportedSession) })
    const view = renderApp("/")

    await view.findByRole("button", { name: "Streamy" })

    const link = view.getByRole("link", { name: "Support on Ko-fi" })
    expect(link.getAttribute("href")).toBe(donateUrl)
    expect(link.closest(".home-footer")).not.toBeNull()
  })

  it("names no platform on a support page other than Ko-fi", async () => {
    const sponsors = "https://github.com/sponsors/rafflink"
    mockFetch({
      "GET /api/session": () =>
        ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: sponsors, operator: null }),
    })
    const view = renderApp("/")

    const link = await view.findByRole("link", { name: "Support Rafflink" })

    expect(link.getAttribute("href")).toBe(sponsors)
  })

  it("shows no support link when no page is configured", async () => {
    mockFetch({ "GET /api/session": () => ok({ ...supportedSession, donateUrl: null }) })
    const view = renderApp("/")

    await view.findByRole("button", { name: "Streamy" })

    expect(view.container.querySelector(".donate-link")).toBeNull()
  })

  it("links the repository, the setup guide, the verifier and the legal pages in the footer", () => {
    const view = renderApp("/")

    const footer = within(view.getByRole("navigation", { name: "Footer" }))

    expect(footer.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink",
    )
    expect(footer.getByRole("link", { name: "Self-host guide" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink#twitch-app-registration",
    )
    for (const name of ["GitHub", "Self-host guide"]) {
      const link = footer.getByRole("link", { name })
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.getAttribute("rel")).toBe("noopener")
      const hint = document.getElementById(link.getAttribute("aria-describedby") ?? "")
      expect(hint?.textContent).toBe("Opens in a new tab")
    }
    expect(footer.getByRole("link", { name: "Privacy" }).hasAttribute("target")).toBe(false)
    expect(footer.getByRole("link", { name: "Verify a draw" }).getAttribute("href")).toBe("/verify")
    expect(footer.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy")
    expect(footer.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms")
  })

  it("puts Self-host and GitHub in the app header nav and no demo link anywhere", () => {
    const view = renderApp("/")

    const nav = within(view.getByRole("navigation", { name: "Main" }))

    expect(nav.getByRole("link", { name: "Self-host" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink#twitch-app-registration",
    )
    expect(nav.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink",
    )
    for (const name of ["Self-host", "GitHub"]) {
      const link = nav.getByRole("link", { name })
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.getAttribute("rel")).toBe("noopener")
    }
    expect(nav.queryByRole("link", { name: "Verify a draw" })).toBeNull()
    expect(view.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/dashboard")
    expect(
      view.getAllByRole("link").filter((link) => link.getAttribute("href") === "/demo"),
    ).toEqual([])
  })

  it("keeps the theme and language switches inside one settings button", () => {
    const view = renderApp("/")

    const button = view.getByRole("button", { name: "Display settings" })
    const panel = view.container.querySelector("[popover]")

    expect(panel).not.toBeNull()
    expect(button.getAttribute("popovertarget")).toBe(panel?.id ?? "no panel")
    const inPanel = within(panel instanceof HTMLElement ? panel : document.body)
    expect(inPanel.getByRole("radio", { name: "Dark" })).toBeTruthy()
    expect(inPanel.getByRole("radio", { name: "Slovenčina" })).toBeTruthy()
  })

  it("tells a Google account without a YouTube channel to sign in with the channel's account", () => {
    const view = renderApp("/?signin=no-channel")

    expect(view.getByRole("alert").textContent).toBe(
      "This Google account has no YouTube channel. Sign in with the account that owns your channel.",
    )
  })

  it("shows why a failed sign-in came back to the home page", () => {
    const view = renderApp("/?signin=try-again")

    expect(view.getByRole("alert").textContent).toBe(
      "The streaming platform did not answer. Please try again.",
    )
  })
})
