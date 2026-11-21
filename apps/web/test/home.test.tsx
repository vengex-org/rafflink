import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { languageStorageKey } from "../src/i18n/language.ts"
import { renderApp } from "./render-app.tsx"

beforeEach(() => {
  mockFetch({})
})
afterEach(() => {
  cleanup()
  mock.restore()
  window.localStorage.clear()
})

let restoreSocket = () => {}

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms))
const stage = (view: ReturnType<typeof renderApp>) =>
  within(view.getByRole("region", { name: "Example of a draw" }))
const setVisibility = (value: "hidden" | "visible") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, value })
const currentLabel = (view: ReturnType<typeof renderApp>) =>
  view.container.querySelector(".stage-steps [aria-current='step']")?.textContent

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

  describe("example previews", () => {
    beforeEach(() => {
      jest.useFakeTimers()
      restoreSocket = installFakeSocket()
      FakeSocket.opened.length = 0
    })
    afterEach(() => {
      jest.useRealTimers()
      Reflect.deleteProperty(document, "visibilityState")
      restoreSocket()
    })

    it("plays entries open, drawing, winner and claimed in sync on the overlay and the phone, then starts over", () => {
      const view = renderApp("/")
      const preview = stage(view)

      expect(currentLabel(view)).toBe("Entries open")
      expect(preview.getByText("Enter at")).toBeTruthy()
      expect(preview.getByText("DEMO1", { selector: ".overlay-url em" })).toBeTruthy()
      expect(preview.getAllByText("Entries open")).toHaveLength(2)
      expect(view.container.querySelector(".stage-stream .qr")).toBeNull()

      advance(5000)
      expect(currentLabel(view)).toBe("Drawing")
      expect(view.container.querySelector(".stage-stream [data-shuffling]")).not.toBeNull()
      expect(preview.getByText("Drawing a winner…")).toBeTruthy()

      advance(4000)
      expect(currentLabel(view)).toBe("Winner drawn")
      expect(preview.getByText("Winner 1 of 1")).toBeTruthy()
      expect(preview.getByText("A gaming chair", { selector: ".overlay-prize" })).toBeTruthy()
      expect(preview.getAllByText("Kestrel27")).toHaveLength(2)
      expect(preview.getAllByText("0:42")).toHaveLength(2)
      expect(preview.getByText("You won")).toBeTruthy()
      expect(preview.getByText("Claim my prize")).toBeTruthy()

      advance(6000)
      expect(currentLabel(view)).toBe("Claimed")
      expect(preview.getByText("Prize claimed")).toBeTruthy()
      expect(preview.queryByText("Claim my prize")).toBeNull()
      expect(preview.queryByText("0:42")).toBeNull()

      advance(5000)
      expect(currentLabel(view)).toBe("Entries open")
      expect(preview.getByText("Enter at")).toBeTruthy()
    })

    it("waits while the tab is hidden and goes on when it is shown", () => {
      const view = renderApp("/")
      setVisibility("hidden")
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      advance(60_000)
      expect(currentLabel(view)).toBe("Entries open")

      setVisibility("visible")
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      advance(5000)
      expect(currentLabel(view)).toBe("Drawing")
    })

    it("rests on the winner without cycling or step labels under reduced motion", () => {
      spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }))
      const view = renderApp("/")
      const preview = stage(view)

      advance(120_000)

      expect(preview.getByText("Winner 1 of 1")).toBeTruthy()
      expect(preview.getByText("Claim my prize")).toBeTruthy()
      expect(preview.queryByText("Enter at")).toBeNull()
      expect(view.container.querySelector(".stage-steps")).toBeNull()
    })

    it("shows the example prize and title in the page language", () => {
      window.localStorage.setItem(languageStorageKey, "cs")
      const view = renderApp("/")

      advance(5000)
      advance(4000)

      const preview = within(view.getByRole("region", { name: "Ukázka losování" }))
      expect(preview.getByText("Herní křeslo", { selector: ".overlay-prize" })).toBeTruthy()
      expect(preview.getByText("Streamy, Letní soutěž")).toBeTruthy()
      expect(preview.queryByText(/gaming chair|Summer giveaway/)).toBeNull()
    })

    it("switches the overlay text with the page language in the middle of a step", () => {
      const view = renderApp("/")
      advance(5000)
      advance(4000)
      expect(stage(view).getByText("A gaming chair", { selector: ".overlay-prize" })).toBeTruthy()

      fireEvent.click(view.getByRole("radio", { name: "Čeština" }))

      const preview = within(view.getByRole("region", { name: "Ukázka losování" }))
      expect(preview.getByText("Herní křeslo", { selector: ".overlay-prize" })).toBeTruthy()
      expect(preview.queryByText("A gaming chair")).toBeNull()
    })

    it("are inert and hidden from the accessibility tree, with one h1 on the page", () => {
      const view = renderApp("/")

      const hidden = [
        ...view.container.querySelectorAll(".stage-stream, .stage-phone, .step-preview"),
      ]

      expect(hidden).toHaveLength(5)
      for (const element of hidden) {
        const layer = element.classList.contains("stage-phone")
          ? element.querySelector(".stage-viewer")
          : element
        expect(layer?.hasAttribute("inert")).toBe(true)
        expect(element.getAttribute("aria-hidden")).toBe("true")
      }
      expect(view.container.querySelectorAll("h1")).toHaveLength(1)
    })

    it("send no request and open no socket", () => {
      const requests = mockFetch({})

      renderApp("/")

      expect(requests.filter((request) => request.route !== "GET /api/session")).toEqual([])
      expect(FakeSocket.opened).toHaveLength(0)
    })
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
