import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { inputOf } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

function systemPrefersDark(dark: boolean) {
  spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

function refuseStorage() {
  spyOn(console, "warn").mockImplementation(() => {})
  spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied")
  })
  spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied")
  })
}

describe("theme switch", () => {
  it("follows the system by default", () => {
    systemPrefersDark(true)

    const view = renderApp("/")

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(inputOf(view.getByRole("radio", { name: "System" })).checked).toBe(true)
  })

  it("sets data-theme to the chosen scheme and remembers it", () => {
    systemPrefersDark(false)
    const view = renderApp("/")
    expect(document.documentElement.dataset.theme).toBe("light")

    fireEvent.click(view.getByRole("radio", { name: "Dark" }))

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(window.localStorage.getItem("rafflink-theme")).toBe("dark")

    view.unmount()
    renderApp("/")
    expect(document.documentElement.dataset.theme).toBe("dark")
  })

  it("goes back to the system preference when System is chosen", () => {
    window.localStorage.setItem("rafflink-theme", "light")
    systemPrefersDark(true)
    const view = renderApp("/")
    expect(document.documentElement.dataset.theme).toBe("light")

    fireEvent.click(view.getByRole("radio", { name: "System" }))

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(window.localStorage.getItem("rafflink-theme")).toBe("system")
  })

  it("falls back to the system when the remembered value is unknown", () => {
    window.localStorage.setItem("rafflink-theme", "sepia")
    systemPrefersDark(false)

    renderApp("/")

    expect(document.documentElement.dataset.theme).toBe("light")
  })

  it("works when the browser refuses storage", () => {
    systemPrefersDark(false)
    refuseStorage()
    const view = renderApp("/")

    fireEvent.click(view.getByRole("radio", { name: "Dark" }))

    expect(document.documentElement.dataset.theme).toBe("dark")
  })
})
