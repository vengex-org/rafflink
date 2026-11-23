import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, waitFor, within } from "@testing-library/react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { AppRoutes } from "../src/app.tsx"
import { loadDictionary } from "../src/i18n/dictionaries.ts"
import { languages, type Language } from "../src/i18n/language.ts"
import { localizedPages, localizedPath, type LocalizedPage } from "../src/lib/routes.ts"
import { inputOf } from "./queries.ts"
import { mockFetch } from "./mock-fetch.ts"

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  mockFetch({})
})

afterEach(() => {
  unmount()
  mock.restore()
  window.localStorage.clear()
  document.documentElement.lang = "en"
})

function unmount() {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
}

function app(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  )
}

/**
 * Renders `path` to HTML as a build would, with nothing in storage; `visit` then sets what the visitor's browser
 * holds, and the page hydrates at `address`, which may add a query.
 */
async function hydrate(
  path: string,
  visit: { address?: string; stored?: Record<string, string> } = {},
) {
  const html = renderToString(app(path))
  for (const [key, value] of Object.entries(visit.stored ?? {})) {
    window.localStorage.setItem(key, value)
  }
  const element = document.createElement("div")
  element.innerHTML = html
  document.body.append(element)
  container = element
  const recoverable = mock<(error: unknown) => void>()
  await act(async () => {
    root = hydrateRoot(element, app(visit.address ?? path), { onRecoverableError: recoverable })
  })
  return { html, element, recoverable }
}

const pageTitles: Readonly<Record<LocalizedPage, "home.title" | "privacy.title" | "terms.title">> =
  {
    home: "home.title",
    privacy: "privacy.title",
    terms: "terms.title",
  }

/** A language stored by a visitor of a page in `language`, never that language itself. */
function otherLanguage(language: Language): Language {
  return language === "cs" ? "sk" : "cs"
}

describe("hydration of a prerendered page", () => {
  it("takes over the home page with a stored theme and a ?signin= query without a mismatch", async () => {
    const errors = spyOn(console, "error")

    const { html, element, recoverable } = await hydrate("/", {
      address: "/?signin=try-again",
      stored: { "rafflink-theme": "dark" },
    })

    expect(html).not.toContain('role="alert"')
    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    const page = within(element)
    expect(page.getByRole("alert").textContent).toBe(
      "The streaming platform did not answer. Please try again.",
    )
    expect(inputOf(page.getByRole("radio", { name: "Dark" })).checked).toBe(true)
  })

  it("takes over every localized page in its language, with and without another language stored", async () => {
    const errors = spyOn(console, "error")
    for (const language of languages) {
      const dictionary = await loadDictionary(language)
      for (const page of localizedPages) {
        for (const stored of [{}, { "rafflink-language": otherLanguage(language) }]) {
          const path = localizedPath(language, page)

          const { element, recoverable } = await hydrate(path, { stored })

          expect([path, stored, recoverable.mock.calls.length]).toEqual([path, stored, 0])
          // `/` opens a stored language's home page after hydration, as its own test shows.
          if (path !== "/") {
            expect([path, within(element).getByRole("heading", { level: 1 }).textContent]).toEqual([
              path,
              dictionary[pageTitles[page]],
            ])
          }
          unmount()
          window.localStorage.clear()
        }
      }
    }
    expect(errors).not.toHaveBeenCalled()
  })

  it("shows the card of a failed platform sign-in after hydration without a mismatch", async () => {
    const errors = spyOn(console, "error")

    const { element, recoverable } = await hydrate("/", {
      address: "/?error=access_denied&platform=twitch",
    })

    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    await waitFor(() => expect(within(element).getAllByRole("alert").length).toBeGreaterThan(0))
  })
})
