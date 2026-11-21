import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test"
import { act, cleanup, within } from "@testing-library/react"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

beforeEach(() => {
  mockFetch({})
})
afterEach(() => {
  cleanup()
  mock.restore()
})

describe("home page", () => {
  it("opens with the one-sentence promise as the only h1", () => {
    const view = renderApp("/")

    const headings = view.getAllByRole("heading", { level: 1 })

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Fair Twitch giveaways, drawn live on stream.",
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

    const login = view.getByRole("link", { name: "Log in with Twitch" })

    expect(login.getAttribute("href")).toBe("/dashboard")
  })

  it("offers My giveaways instead of logging in when the streamer is signed in, from one session call", async () => {
    const requests = mockFetch({
      "GET /api/session": () =>
        ok({ streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: null } }),
    })
    const view = renderApp("/")

    await view.findByRole("button", { name: "Streamy" })

    const cta = view.getByRole("link", { name: "My giveaways" })
    expect(cta.getAttribute("href")).toBe("/dashboard")
    expect(view.queryByRole("link", { name: "Log in with Twitch" })).toBeNull()
    expect(requests.filter((request) => request.route === "GET /api/session")).toHaveLength(1)
  })

  it("explains the flow in three steps", () => {
    const view = renderApp("/")

    const steps = within(view.getByRole("list", { name: "How it works" })).getAllByRole("listitem")

    expect(
      steps.map((step) => within(step).getByRole("heading", { level: 3 }).textContent),
    ).toEqual(["Create the giveaway", "Share one short link", "Draw live"])
  })

  it("previews the draw with the real overlay plate and the real claim panel of the example winner", () => {
    const view = renderApp("/")

    const preview = within(view.getByRole("region", { name: "Example of a draw" }))

    expect(preview.getByText("Winner 1 of 1")).toBeTruthy()
    expect(preview.getByText("A gaming chair", { selector: ".overlay-prize" })).toBeTruthy()
    expect(preview.getByRole("img", { name: /QR code/ })).toBeTruthy()
    expect(preview.getAllByText("mira_vex")).toHaveLength(2)
    expect(preview.getAllByText("0:42")).toHaveLength(2)
    expect(preview.getByText("You won")).toBeTruthy()
    expect(preview.getByText("Claim my prize")).toBeTruthy()
  })

  it("keeps the phone preview out of the tab order and the accessibility tree, with one h1 on the page", () => {
    const view = renderApp("/")

    const phone = view.container.querySelector(".stage-phone")

    expect(phone?.getAttribute("aria-hidden")).toBe("true")
    expect(phone?.querySelector("[inert] button")).not.toBeNull()
    expect(view.container.querySelectorAll("h1")).toHaveLength(1)
  })

  it("shows the example claim clock from the start again before it runs out", () => {
    jest.useFakeTimers()
    const view = renderApp("/")
    const stage = within(view.getByRole("region", { name: "Example of a draw" }))

    act(() => jest.advanceTimersByTime(29_000))
    expect(stage.queryAllByText("0:42")).toHaveLength(0)

    act(() => jest.advanceTimersByTime(1000))
    expect(stage.getAllByText("0:42")).toHaveLength(2)
    jest.useRealTimers()
  })

  it("sends no request and opens no socket for the previews", () => {
    const restoreSocket = installFakeSocket()
    FakeSocket.opened.length = 0
    const requests = mockFetch({})

    renderApp("/")

    expect(requests.filter((request) => request.route !== "GET /api/session")).toEqual([])
    expect(FakeSocket.opened).toHaveLength(0)
    restoreSocket()
  })

  it("explains how tickets work without promising that viewers see their odds", () => {
    const view = renderApp("/")

    const tickets = within(view.getByRole("region", { name: "How tickets work." }))

    expect(tickets.getByText("1 ticket")).toBeTruthy()
    expect(tickets.getByText("5 tickets")).toBeTruthy()
    expect(view.queryByText(/everyone sees the odds/i)).toBeNull()
  })

  it("says Rafflink is open source under the AGPL and links the setup guide", () => {
    const view = renderApp("/")

    const selfHost = within(view.getByRole("region", { name: "Yours to run." }))

    expect(selfHost.getByText(/AGPL-3\.0 licensed/).textContent).not.toContain("MIT")
    expect(selfHost.getByText(/bunx wrangler deploy/)).toBeTruthy()
    expect(selfHost.getByRole("link", { name: "Read the setup guide" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink#twitch-app-registration",
    )
  })

  it("puts the nav anchors and the log-in button in the app header", () => {
    const view = renderApp("/")

    const nav = within(view.getByRole("navigation", { name: "Main" }))

    expect(nav.getByRole("link", { name: "How it works" }).getAttribute("href")).toBe("/#how")
    expect(nav.getByRole("link", { name: "Self-host" }).getAttribute("href")).toBe("/#self-host")
    expect(nav.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink",
    )
    expect(nav.queryByRole("link", { name: "Fair odds" })).toBeNull()
    expect(view.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/dashboard")
  })

  it("opens the demo from the hero only, not from the header", () => {
    const view = renderApp("/")

    const header = within(view.getByRole("banner"))
    const demoLinks = view
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/demo")

    expect(header.queryByRole("link", { name: "Demo giveaway" })).toBeNull()
    expect(demoLinks.map((link) => link.textContent)).toEqual(["Try the demo"])
    expect(view.queryByRole("link", { name: "Open the demo giveaway" })).toBeNull()
  })

  it("keeps the theme and language switches inside one settings button", () => {
    const view = renderApp("/")

    const button = view.getByRole("button", { name: "Settings" })
    const panel = view.container.querySelector("[popover]")

    expect(panel).not.toBeNull()
    expect(button.getAttribute("popovertarget")).toBe(panel?.id ?? "no panel")
    const inPanel = within(panel instanceof HTMLElement ? panel : document.body)
    expect(inPanel.getByRole("radio", { name: "Dark" })).toBeTruthy()
    expect(inPanel.getByRole("radio", { name: "Slovenčina" })).toBeTruthy()
  })

  it("shows why a failed sign-in came back to the home page", () => {
    const view = renderApp("/?signin=try-again")

    expect(view.getByRole("alert").textContent).toBe("Twitch did not answer. Please try again.")
  })
})
