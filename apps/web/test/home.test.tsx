import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import { renderApp } from "./render-app.tsx"

afterEach(cleanup)

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

  it("previews the winner plate, the entry state and the claim clock", () => {
    const view = renderApp("/")

    const preview = within(view.getByRole("region", { name: "Example of a draw" }))

    expect(preview.getByText("mira_vex")).toBeTruthy()
    expect(preview.getByText("Entries open")).toBeTruthy()
    expect(preview.getByRole("timer").textContent).toBe("0:42")
  })

  it("says Rafflink is open source under the AGPL and links the setup guide", () => {
    const view = renderApp("/")

    expect(view.getByText(/open source/i).textContent).toContain("AGPL-3.0")
    expect(view.getByRole("link", { name: "Setup guide on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/vengex-org/rafflink#twitch-app-registration",
    )
  })

  it("shows why a failed sign-in came back to the home page", () => {
    const view = renderApp("/?signin=try-again")

    expect(view.getByRole("alert").textContent).toBe("Twitch did not answer. Please try again.")
  })
})
