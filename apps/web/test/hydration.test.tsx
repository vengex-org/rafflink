import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, waitFor, within } from "@testing-library/react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { AppRoutes } from "../src/app.tsx"
import { inputOf } from "./queries.ts"
import { mockFetch } from "./mock-fetch.ts"

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  mockFetch({})
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  mock.restore()
  window.localStorage.clear()
  document.documentElement.lang = "en"
})

function app(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  )
}

/** Renders `path` to HTML as a build would, then hydrates it in the browser at `address`, which may add a query. */
async function hydrate(path: string, address = path) {
  const html = renderToString(app(path))
  const element = document.createElement("div")
  element.innerHTML = html
  document.body.append(element)
  container = element
  const recoverable = mock<(error: unknown) => void>()
  await act(async () => {
    root = hydrateRoot(element, app(address), { onRecoverableError: recoverable })
  })
  return { html, element, recoverable }
}

describe("hydration of a prerendered page", () => {
  it("takes over the home page with a stored theme and a ?signin= query without a mismatch", async () => {
    window.localStorage.setItem("rafflink-theme", "dark")
    const errors = spyOn(console, "error")

    const { html, element, recoverable } = await hydrate("/", "/?signin=try-again")

    expect(html).not.toContain('role="alert"')
    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    const page = within(element)
    expect(page.getByRole("alert").textContent).toBe(
      "The streaming platform did not answer. Please try again.",
    )
    expect(inputOf(page.getByRole("radio", { name: "Dark" })).checked).toBe(true)
  })

  it("keeps the language of the address with another language stored", async () => {
    window.localStorage.setItem("rafflink-language", "cs")
    const errors = spyOn(console, "error")

    const { element, recoverable } = await hydrate("/de/privacy")

    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(within(element).getByRole("heading", { level: 1 }).textContent).toBe(
      "Datenschutzerklärung",
    )
  })

  it("shows the card of a failed platform sign-in after hydration without a mismatch", async () => {
    const errors = spyOn(console, "error")

    const { element, recoverable } = await hydrate("/", "/?error=access_denied&platform=twitch")

    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    await waitFor(() => expect(within(element).getAllByRole("alert").length).toBeGreaterThan(0))
  })
})
