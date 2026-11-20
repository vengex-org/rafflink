import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { dictionaries } from "../src/i18n/dictionaries.ts"
import { detectLanguage, languages } from "../src/i18n/language.ts"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
  window.localStorage.clear()
  document.documentElement.lang = "en"
  Reflect.deleteProperty(navigator, "language")
})

function browserLanguage(tag: string) {
  Object.defineProperty(navigator, "language", { configurable: true, value: tag })
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).toSorted()

describe("language", () => {
  it("picks Czech for cs, Slovak for sk and English for everything else", () => {
    expect(detectLanguage("cs-CZ")).toBe("cs")
    expect(detectLanguage("sk-SK")).toBe("sk")
    expect(detectLanguage("SK")).toBe("sk")
    expect(detectLanguage("en-GB")).toBe("en")
    expect(detectLanguage("de-DE")).toBe("en")
    expect(detectLanguage("")).toBe("en")
  })

  it("starts in English when the browser asks for it", () => {
    browserLanguage("en-US")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Fair Twitch giveaways, drawn live on stream." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("en")
  })

  it("detects Slovak from sk-SK on the first visit and sets the page language", () => {
    browserLanguage("sk-SK")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové Twitch súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("sk")
  })

  it("detects Czech from cs-CZ on the first visit and sets the page language", () => {
    browserLanguage("cs-CZ")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové Twitch soutěže, losované živě na streamu." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("cs")
  })

  it("changes every visible text and the page language when the switch is used, and remembers it", () => {
    browserLanguage("en-US")
    const view = renderApp("/")

    fireEvent.click(view.getByRole("radio", { name: "Slovenčina" }))

    expect(
      view.getByRole("heading", { name: "Férové Twitch súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
    expect(view.getByRole("link", { name: "Moje súťaže" })).toBeTruthy()
    expect(document.documentElement.lang).toBe("sk")
    expect(window.localStorage.getItem("rafflink-language")).toBe("sk")

    view.unmount()
    const again = renderApp("/")
    expect(
      again.getByRole("heading", { name: "Férové Twitch súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
  })

  it("prefers the remembered choice over the browser language", () => {
    window.localStorage.setItem("rafflink-language", "cs")
    browserLanguage("sk-SK")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové Twitch soutěže, losované živě na streamu." }),
    ).toBeTruthy()
  })

  it("ignores a remembered value that is not a language", () => {
    window.localStorage.setItem("rafflink-language", "klingon")
    browserLanguage("en-US")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Fair Twitch giveaways, drawn live on stream." }),
    ).toBeTruthy()
  })

  it("works when the browser refuses storage", () => {
    browserLanguage("en-US")
    spyOn(console, "warn").mockImplementation(() => {})
    spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Fair Twitch giveaways, drawn live on stream." }),
    ).toBeTruthy()
    fireEvent.click(view.getByRole("radio", { name: "Čeština" }))

    expect(
      view.getByRole("heading", { name: "Férové Twitch soutěže, losované živě na streamu." }),
    ).toBeTruthy()
  })

  it("counts people with the plural form of the language", async () => {
    browserLanguage("sk-SK")
    const counts = [
      [1, "Zapísal sa 1 človek"],
      [3, "Zapísali sa 3 ľudia"],
      [1204, "Zapísalo sa 1 204 ľudí"],
    ] as const
    for (const [entrantCount, text] of counts) {
      window.sessionStorage.clear()
      mockFetch({
        "GET /api/g/ABCDE": () => ok({ ...giveaway, entrantCount }),
      })
      const view = renderApp("/ABCDE")
      const found = await view.findByText(
        (_, element) => element?.textContent?.replace(/\s/g, " ") === text,
      )
      expect(found).toBeTruthy()
      view.unmount()
      mock.restore()
    }
  })

  it("keeps the same keys and the same placeholders in every language", () => {
    const [source, ...others] = languages
    const sourceKeys = Object.keys(dictionaries[source]).toSorted()
    for (const language of others) {
      expect(Object.keys(dictionaries[language]).toSorted()).toEqual(sourceKeys)
    }
    for (const key of sourceKeys) {
      const expected = placeholders(String(Reflect.get(dictionaries[source], key)))
      for (const language of others) {
        const actual = placeholders(String(Reflect.get(dictionaries[language], key)))
        expect([language, key, actual]).toEqual([language, key, expected])
      }
    }
  })
})
