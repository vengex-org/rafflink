import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import { mockFetch } from "./mock-fetch.ts"
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

  it("explains the flow in three steps", () => {
    const view = renderApp("/")

    const steps = within(view.getByRole("list", { name: "How it works" })).getAllByRole("listitem")

    expect(
      steps.map((step) => within(step).getByRole("heading", { level: 3 }).textContent),
    ).toEqual(["Create the giveaway", "Share one short link", "Draw live"])
  })

  it("previews the draw on stream and on the winner's phone", () => {
    const view = renderApp("/")

    const preview = within(view.getByRole("region", { name: "Example of a draw" }))

    expect(preview.getByText("Winner 2 of 3")).toBeTruthy()
    expect(preview.getAllByText("mira_vex").length).toBeGreaterThan(0)
    expect(preview.getAllByText("0:42")).toHaveLength(2)
    expect(preview.getByText("You won")).toBeTruthy()
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

  it("opens the demo from the header, the hero and the how-it-works section", () => {
    const view = renderApp("/")

    const links = ["Demo giveaway", "Try the demo", "Open the demo giveaway"].map((name) =>
      view.getByRole("link", { name }).getAttribute("href"),
    )

    expect(links).toEqual(["/demo", "/demo", "/demo"])
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
