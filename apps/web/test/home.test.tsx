import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { donateUrl, supportedSession } from "./fixtures.ts"
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

/** Step of the fake clock per act; every time the tests reach is a multiple of it. */
const tickMs = 100
/**
 * Moves the fake clock in ticks of {@link tickMs}: act renders a state change only when it returns, so a timer that
 * sets state and the timer the next render arms must not share one act.
 */
const advance = (ms: number) => {
  for (let passed = 0; passed < ms; passed += tickMs) act(() => jest.advanceTimersByTime(tickMs))
}
const stage = (view: ReturnType<typeof renderApp>) =>
  within(view.getByRole("region", { name: "Example of a draw" }))
const setVisibility = (value: "hidden" | "visible") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, value })
const currentLabel = (view: ReturnType<typeof renderApp>) =>
  view.container.querySelector(".stage-steps [aria-current='step']")?.textContent
const progress = (view: ReturnType<typeof renderApp>) => {
  const bar = view.container.querySelector(".stage-progress")
  if (!(bar instanceof HTMLElement)) throw new Error("no progress bar")
  return bar
}
const segmentStates = (view: ReturnType<typeof renderApp>) =>
  [...progress(view).children].map((segment) => segment.getAttribute("data-state"))
const preferReducedMotion = () =>
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
const phoneScreen = (view: ReturnType<typeof renderApp>) => {
  const screen = view.container.querySelector(".stage-screen")
  if (!(screen instanceof HTMLElement)) throw new Error("no phone screen")
  return screen
}
/** A mouse event on the phone with an explicit `timeStamp`, so the fake clock never decides about a glide. */
const mouse = (
  screen: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientY: number,
  timeStamp: number,
) => {
  const event = new PointerEvent(type, {
    clientY,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, "timeStamp", { value: timeStamp })
  act(() => {
    screen.dispatchEvent(event)
  })
}
const preparePhone = (view: ReturnType<typeof renderApp>) => {
  const screen = phoneScreen(view)
  Object.defineProperty(screen, "scrollHeight", { configurable: true, value: 1000 })
  Object.defineProperty(screen, "clientHeight", { configurable: true, value: 600 })
  screen.setPointerCapture = () => {}
  return screen
}
/** Drags the phone's content up by `distance` px with the mouse and lets go without a flick. */
const dragPhone = (view: ReturnType<typeof renderApp>, distance: number) => {
  const screen = preparePhone(view)
  mouse(screen, "pointerdown", 400, 0)
  mouse(screen, "pointermove", 400 - distance, 100)
  advance(500)
  mouse(screen, "pointerup", 400 - distance, 1000)
  return screen
}

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
        ok({
          streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: null },
          donateUrl: null,
        }),
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

    it("keeps the overlay host mark and the support link out of every step", () => {
      mock.restore()
      mockFetch({ "GET /api/session": () => ok(supportedSession) })
      const view = renderApp("/")
      const preview = view.getByRole("region", { name: "Example of a draw" })

      for (const ms of [0, 5000, 4000, 6000]) {
        advance(ms)
        expect(preview.querySelector(".overlay-mark")).toBeNull()
        expect(preview.querySelector(`a[href="${donateUrl}"]`)).toBeNull()
      }
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

    it("holds the step while the visitor scrolls the phone and plays the rest of it a while after the last touch", () => {
      const view = renderApp("/")
      advance(4000)

      dragPhone(view, 60)
      advance(4900)
      expect(currentLabel(view)).toBe("Entries open")

      advance(100)
      expect(currentLabel(view)).toBe("Drawing")
    })

    it("holds the step while the mouse stays pressed on the phone beyond the hold time", () => {
      const view = renderApp("/")
      advance(4000)
      const screen = preparePhone(view)

      mouse(screen, "pointerdown", 400, 0)
      advance(10_000)
      expect(currentLabel(view)).toBe("Entries open")

      mouse(screen, "pointerup", 400, 10_000)
      advance(4900)
      expect(currentLabel(view)).toBe("Entries open")

      advance(100)
      expect(currentLabel(view)).toBe("Drawing")
    })

    it("shows each new step on the phone from the top", () => {
      const view = renderApp("/")
      const scrolled = dragPhone(view, 60)
      expect(scrolled.scrollTop).toBe(60)

      advance(9000)

      const screen = phoneScreen(view)
      expect(currentLabel(view)).toBe("Drawing")
      expect(screen).not.toBe(scrolled)
      expect(screen.scrollTop).toBe(0)
    })

    it("rests on the winner without cycling under reduced motion, paused until the visitor plays it", () => {
      preferReducedMotion()
      const view = renderApp("/")
      const preview = stage(view)

      advance(120_000)

      expect(preview.getByText("Winner 1 of 1")).toBeTruthy()
      expect(preview.getByText("Claim my prize")).toBeTruthy()
      expect(preview.queryByText("Enter at")).toBeNull()
      expect(currentLabel(view)).toBe("Winner drawn")
      expect(progress(view).hasAttribute("data-paused")).toBe(true)

      fireEvent.click(preview.getByRole("button", { name: "Play preview" }))
      advance(6000)
      expect(currentLabel(view)).toBe("Claimed")
    })

    it("switches steps by their labels under reduced motion without starting the loop", () => {
      preferReducedMotion()
      const view = renderApp("/")
      const preview = stage(view)

      fireEvent.click(preview.getByRole("button", { name: "Drawing" }))
      advance(60_000)

      expect(currentLabel(view)).toBe("Drawing")
      expect(preview.getByText("Drawing a winner…")).toBeTruthy()
      expect(preview.getByRole("button", { name: "Play preview" })).toBeTruthy()
    })

    it("stops on the current step when paused and plays the rest of it when played", () => {
      const view = renderApp("/")
      const preview = stage(view)
      advance(3000)

      fireEvent.click(preview.getByRole("button", { name: "Pause preview" }))
      advance(60_000)
      expect(currentLabel(view)).toBe("Entries open")

      fireEvent.click(preview.getByRole("button", { name: "Play preview" }))
      advance(1900)
      expect(currentLabel(view)).toBe("Entries open")
      advance(100)
      expect(currentLabel(view)).toBe("Drawing")
      expect(preview.getByRole("button", { name: "Pause preview" })).toBeTruthy()
    })

    it("jumps to a clicked step and gives it its full time, also when it is the step shown", () => {
      const view = renderApp("/")
      const preview = stage(view)
      advance(3000)

      fireEvent.click(preview.getByRole("button", { name: "Winner drawn" }))
      expect(currentLabel(view)).toBe("Winner drawn")
      expect(preview.getByText("Winner 1 of 1")).toBeTruthy()
      advance(5900)
      expect(currentLabel(view)).toBe("Winner drawn")
      advance(100)
      expect(currentLabel(view)).toBe("Claimed")

      advance(4000)
      fireEvent.click(preview.getByRole("button", { name: "Claimed" }))
      advance(4900)
      expect(currentLabel(view)).toBe("Claimed")
      advance(100)
      expect(currentLabel(view)).toBe("Entries open")
    })

    it("marks only the shown step as current, on the labels and on the bar", () => {
      const view = renderApp("/")
      const preview = stage(view)

      fireEvent.click(preview.getByRole("button", { name: "Drawing" }))

      const current = preview
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "step")
      expect(current.map((button) => button.textContent)).toEqual(["Drawing"])
      expect(segmentStates(view)).toEqual(["done", "current", null, null])
    })

    it("shows a clicked step while paused and starts it from the beginning on play", () => {
      const view = renderApp("/")
      const preview = stage(view)
      fireEvent.click(preview.getByRole("button", { name: "Pause preview" }))

      fireEvent.click(preview.getByRole("button", { name: "Drawing" }))
      advance(60_000)
      expect(currentLabel(view)).toBe("Drawing")
      expect(progress(view).hasAttribute("data-paused")).toBe(true)

      fireEvent.click(preview.getByRole("button", { name: "Play preview" }))
      advance(3900)
      expect(currentLabel(view)).toBe("Drawing")
      advance(100)
      expect(currentLabel(view)).toBe("Winner drawn")
    })

    it("pauses the progress bar with the loop and starts a new bar on a step change", () => {
      const view = renderApp("/")
      const preview = stage(view)
      const firstBar = progress(view)
      expect(firstBar.hasAttribute("data-paused")).toBe(false)

      fireEvent.click(preview.getByRole("button", { name: "Pause preview" }))
      expect(progress(view).hasAttribute("data-paused")).toBe(true)
      fireEvent.click(preview.getByRole("button", { name: "Play preview" }))
      expect(progress(view).hasAttribute("data-paused")).toBe(false)

      setVisibility("hidden")
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(progress(view).hasAttribute("data-paused")).toBe(true)
      setVisibility("visible")
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(progress(view).hasAttribute("data-paused")).toBe(false)

      const screen = preparePhone(view)
      mouse(screen, "pointerdown", 400, 0)
      expect(progress(view).hasAttribute("data-paused")).toBe(true)
      mouse(screen, "pointerup", 400, 100)
      advance(3900)
      expect(progress(view).hasAttribute("data-paused")).toBe(true)
      advance(100)
      expect(progress(view).hasAttribute("data-paused")).toBe(false)

      advance(5000)
      expect(currentLabel(view)).toBe("Drawing")
      expect(progress(view)).not.toBe(firstBar)
      expect(segmentStates(view)).toEqual(["done", "current", null, null])
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
