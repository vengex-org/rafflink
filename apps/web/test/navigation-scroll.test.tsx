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

  it("brings the element a #link names into view", async () => {
    const shown: Element[] = []
    spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      shown.push(this)
    })
    const view = renderApp("/terms")

    await view.go("/privacy#main")

    expect(shown).toEqual([view.container.ownerDocument.getElementById("main") as Element])
  })
})
