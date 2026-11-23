import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { dictionaryLoaders, loadDictionary } from "../src/i18n/dictionaries.ts"
import { en } from "../src/i18n/en.ts"
import { pluralForm } from "../src/i18n/i18n.tsx"
import { detectLanguage, languageNames, languages } from "../src/i18n/language.ts"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

beforeEach(() => {
  mockFetch({})
})

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
  it("picks the language of the primary subtag when it has a dictionary, else English", () => {
    expect(detectLanguage("cs-CZ")).toBe("cs")
    expect(detectLanguage("sk-SK")).toBe("sk")
    expect(detectLanguage("SK")).toBe("sk")
    expect(detectLanguage("de-AT")).toBe("de")
    expect(detectLanguage("en-GB")).toBe("en")
    expect(detectLanguage("ja-JP")).toBe("en")
    expect(detectLanguage("constructor")).toBe("en")
    expect(detectLanguage("")).toBe("en")
  })

  it("lists every language with a dictionary in the switch, each named in itself", () => {
    browserLanguage("en-US")
    const view = renderApp("/")

    const group = within(view.getByRole("group", { name: "Language" }))
    expect(group.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual(
      languages.map((language) => `${language.toUpperCase()}${languageNames[language]}`),
    )
    expect(group.getByRole("radio", { name: "Deutsch" })).toBeTruthy()
  })

  it("detects German from de-DE on the first visit and sets the page language", () => {
    browserLanguage("de-DE")

    const view = renderApp("/")

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      "Faire Gewinnspiele, live im Stream gezogen.",
    )
    expect(document.documentElement.lang).toBe("de")
  })

  it("picks the plural key of every CLDR category the languages use", () => {
    const polish = new Intl.PluralRules("pl")
    expect([1, 3, 5, 22, 0].map((count) => pluralForm(polish.select(count)))).toEqual([
      "one",
      "few",
      "many",
      "few",
      "many",
    ])
    const english = new Intl.PluralRules("en")
    expect([1, 2].map((count) => pluralForm(english.select(count)))).toEqual(["one", "other"])
  })

  it("starts in English when the browser asks for it", () => {
    browserLanguage("en-US")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Fair giveaways, drawn live on stream." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("en")
  })

  it("detects Slovak from sk-SK on the first visit and sets the page language", () => {
    browserLanguage("sk-SK")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("sk")
  })

  it("detects Czech from cs-CZ on the first visit and sets the page language", () => {
    browserLanguage("cs-CZ")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové soutěže, losované živě na streamu." }),
    ).toBeTruthy()
    expect(document.documentElement.lang).toBe("cs")
  })

  it("changes every visible text and the page language when the switch is used, and remembers it", async () => {
    browserLanguage("en-US")
    const view = renderApp("/")

    fireEvent.click(view.getByRole("radio", { name: "Slovenčina" }))

    expect(
      await view.findByRole("heading", { name: "Férové súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
    expect(view.getByRole("link", { name: "Prihlásiť sa" })).toBeTruthy()
    await waitFor(() => expect(document.documentElement.lang).toBe("sk"))
    expect(window.localStorage.getItem("rafflink-language")).toBe("sk")

    view.unmount()
    const again = renderApp("/")
    expect(
      again.getByRole("heading", { name: "Férové súťaže, žrebované naživo na streame." }),
    ).toBeTruthy()
  })

  it("prefers the remembered choice over the browser language", () => {
    window.localStorage.setItem("rafflink-language", "cs")
    browserLanguage("sk-SK")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Férové soutěže, losované živě na streamu." }),
    ).toBeTruthy()
  })

  it("ignores a remembered value that is not a language", () => {
    window.localStorage.setItem("rafflink-language", "klingon")
    browserLanguage("en-US")

    const view = renderApp("/")

    expect(
      view.getByRole("heading", { name: "Fair giveaways, drawn live on stream." }),
    ).toBeTruthy()
  })

  it("works when the browser refuses storage", async () => {
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
      view.getByRole("heading", { name: "Fair giveaways, drawn live on stream." }),
    ).toBeTruthy()
    fireEvent.click(view.getByRole("radio", { name: "Čeština" }))

    expect(
      await view.findByRole("heading", { name: "Férové soutěže, losované živě na streamu." }),
    ).toBeTruthy()
  })

  it("keeps the shown language and logs when a dictionary fails to load", async () => {
    browserLanguage("en-US")
    const failure = new Error("chunk failed")
    const logged = spyOn(console, "error").mockImplementation(() => {})
    spyOn(dictionaryLoaders, "sk").mockImplementation(() => Promise.reject(failure))
    const view = renderApp("/")

    fireEvent.click(view.getByRole("radio", { name: "Slovenčina" }))

    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith("dictionary failed to load", {
        language: "sk",
        error: failure,
      }),
    )
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(en["home.title"])
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

  it("keeps the keys of en.ts and their placeholders in every language", async () => {
    const sourceKeys = Object.keys(en).toSorted()
    for (const language of languages) {
      const dictionary = await loadDictionary(language)
      expect([language, Object.keys(dictionary).toSorted()]).toEqual([language, sourceKeys])
      for (const key of sourceKeys) {
        const expected = placeholders(String(Reflect.get(en, key)))
        const actual = placeholders(String(Reflect.get(dictionary, key)))
        expect([language, key, actual]).toEqual([language, key, expected])
      }
    }
  })
})
