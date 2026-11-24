import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup } from "@testing-library/react"
import { mockFetch } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

beforeEach(() => {
  mockFetch({})
})

afterEach(() => {
  cleanup()
  mock.restore()
  window.scrollTo(0, 0)
})

/** The reader has scrolled down the open page. */
function scrollDown() {
  window.scrollTo(0, 400)
}

describe("scroll on navigation", () => {
  it("opens another page at its top", async () => {
    const view = renderApp("/terms")
    scrollDown()

    await view.go("/privacy")

    expect(window.scrollY).toBe(0)
  })

  it("keeps the scroll when only the query changes", async () => {
    const view = renderApp("/terms")
    scrollDown()

    await view.go("/terms?tab=2")

    expect(window.scrollY).toBe(400)
  })

  it("leaves the scroll to the browser on back", async () => {
    const view = renderApp("/terms")
    await view.go("/privacy")
    scrollDown()

    await view.back()

    expect(window.scrollY).toBe(400)
  })

  // `instant` jumps; `css` leaves the motion to `scroll-behavior`, which glides unless motion is reduced.
  it.each([
    ["opening an address with #id jumps to it", "/terms#main", null, [["main", "instant"]]],
    ["a redirect of the opening address still jumps", "/terms/#main", null, [["main", "instant"]]],
    ["a #link on the same page glides", "/terms", "/terms#main", [["main", "css"]]],
    ["a #link to another page glides", "/terms", "/privacy#main", [["main", "css"]]],
    [
      "a change of the query alone does not scroll again",
      "/terms#main",
      "/terms?tab=2#main",
      [["main", "instant"]],
    ],
  ] as const)("%s", async (_name, opened, followed, expected) => {
    const shown: (readonly [string, string])[] = []
    spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      shown.push([this.id, typeof options === "object" ? (options.behavior ?? "css") : "css"])
    })
    const view = renderApp(opened)

    if (followed !== null) await view.go(followed)

    expect(shown).toEqual([...expected])
  })
})
