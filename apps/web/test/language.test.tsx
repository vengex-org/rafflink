import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, render, waitFor, within } from "@testing-library/react"
import { dictionaryLoaders, loadDictionary } from "../src/i18n/dictionaries.ts"
import { cs } from "../src/i18n/cs.ts"
import { de } from "../src/i18n/de.ts"
import { en } from "../src/i18n/en.ts"
import { sk } from "../src/i18n/sk.ts"
import { I18nProvider, pluralForm, useI18n } from "../src/i18n/i18n.tsx"
import { detectLanguage, languageNames, languages } from "../src/i18n/language.ts"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { chooseLanguage } from "./queries.ts"
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

  it("lists every language with a dictionary in the dropdown, each named in itself", () => {
    browserLanguage("en-US")
    const view = renderApp("/")

    const select = view.getByRole("combobox", { name: "Language" })

    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(languages.map((language) => languageNames[language]))
    expect(select).toHaveProperty("value", "en")
  })

  it("detects German from de-DE on the first visit and sets the page language", () => {
    browserLanguage("de-DE")

    const view = renderApp("/verify")

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(de["verifyLookup.title"])
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

    const view = renderApp("/verify")

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(sk["verifyLookup.title"])
    expect(document.documentElement.lang).toBe("sk")
  })

  it("keeps the English home page at / for a browser asking for another language", async () => {
    browserLanguage("cs-CZ")

    const view = renderApp("/")

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(en["home.title"])
    expect(document.documentElement.lang).toBe("en")
    await act(async () => {})
    expect(view.address()).toBe("/")
  })

  it("changes every visible text and the page language when the switch is used, and remembers it", async () => {
    browserLanguage("en-US")
    const view = renderApp("/verify")

    chooseLanguage(view.container, "Slovenčina")

    expect(
      await view.findByRole("heading", { level: 1, name: sk["verifyLookup.title"] }),
    ).toBeTruthy()
    expect(view.getByRole("button", { name: sk["verifyLookup.submit"] })).toBeTruthy()
    await waitFor(() => expect(document.documentElement.lang).toBe("sk"))
    expect(window.localStorage.getItem("rafflink-language")).toBe("sk")
    expect(view.address()).toBe("/verify")

    view.unmount()
    const again = renderApp("/verify")
    expect(again.getByRole("heading", { level: 1 }).textContent).toBe(sk["verifyLookup.title"])
  })

  it("prefers the remembered choice over the browser language", () => {
    window.localStorage.setItem("rafflink-language", "cs")
    browserLanguage("sk-SK")

    const view = renderApp("/verify")

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(cs["verifyLookup.title"])
  })

  it("opens / in the remembered language once the page has loaded", async () => {
    window.localStorage.setItem("rafflink-language", "cs")

    const view = renderApp("/?ref=giveaway#top")

    expect(
      await view.findByRole("heading", { name: "Férové soutěže, losované živě na streamu." }),
    ).toBeTruthy()
    expect(view.address()).toBe("/cs/?ref=giveaway")
  })

  it("leaves / in English when English is the remembered choice", async () => {
    window.localStorage.setItem("rafflink-language", "en")
    browserLanguage("de-DE")

    const view = renderApp("/")

    await act(async () => {})
    expect(view.address()).toBe("/")
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(en["home.title"])
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
    chooseLanguage(view.container, "Čeština")

    expect(
      await view.findByRole("heading", { name: "Férové soutěže, losované živě na streamu." }),
    ).toBeTruthy()
  })

  it("keeps the shown language, says so and logs when a dictionary fails to load", async () => {
    browserLanguage("en-US")
    const failure = new Error("chunk failed")
    const logged = spyOn(console, "error").mockImplementation(() => {})
    spyOn(dictionaryLoaders, "sk").mockImplementation(() => Promise.reject(failure))
    const view = renderApp("/")

    chooseLanguage(view.container, "Slovenčina")

    expect(await view.findByRole("alert")).toHaveProperty(
      "textContent",
      "This language could not be loaded. Try again.",
    )
    expect(logged).toHaveBeenCalledWith("dictionary failed to load", {
      language: "sk",
      error: failure,
    })
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(en["home.title"])
    expect(view.getByRole("combobox", { name: "Language" })).toHaveProperty("value", "en")
    expect(window.localStorage.getItem("rafflink-language")).toBeNull()
    expect(view.address()).toBe("/")
  })

  it("opens a localized page in the picked language only once its dictionary has loaded", async () => {
    const german = Promise.withResolvers<typeof de>()
    spyOn(dictionaryLoaders, "de").mockImplementation(() => german.promise)
    const view = renderApp("/privacy")

    chooseLanguage(view.container, "Deutsch")
    await act(async () => {})
    expect(view.address()).toBe("/privacy")
    await act(async () => german.resolve(de))

    expect(view.address()).toBe("/de/privacy")
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(de["privacy.title"])
  })

  it.each([
    ["cs", "sk"],
    ["de", "en"],
  ])("goes from / to the language of a ?lang= link with %s stored", async (stored, linked) => {
    window.localStorage.setItem("rafflink-language", stored)

    const view = renderApp(`/?lang=${linked}`)

    await waitFor(() => expect(window.localStorage.getItem("rafflink-language")).toBe(linked))
    await act(async () => {})
    expect(view.address()).toBe(linked === "en" ? "/" : `/${linked}/`)
  })

  it("keeps a one-time parameter when / opens in the remembered language", async () => {
    window.localStorage.setItem("rafflink-language", "de")

    const view = renderApp("/?signin=try-again")

    expect(await view.findByRole("alert")).toHaveProperty(
      "textContent",
      de["home.problem.tryAgain"],
    )
    await waitFor(() => expect(view.address()).toBe("/de/"))
  })

  it("shows the language picked last when an earlier pick loads later", async () => {
    browserLanguage("en-US")
    const slovak = Promise.withResolvers<typeof sk>()
    spyOn(dictionaryLoaders, "sk").mockImplementation(() => slovak.promise)
    const view = renderApp("/")

    chooseLanguage(view.container, "Slovenčina")
    chooseLanguage(view.container, "Deutsch")
    expect(
      await view.findByRole("heading", { name: "Faire Gewinnspiele, live im Stream gezogen." }),
    ).toBeTruthy()
    await act(async () => slovak.resolve(sk))

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      "Faire Gewinnspiele, live im Stream gezogen.",
    )
    expect(window.localStorage.getItem("rafflink-language")).toBe("de")
  })

  it("uses the decimal plural form of Czech and Slovak", () => {
    const shown: string[] = []
    function Probe() {
      shown.push(useI18n().plural("minute", 1.5))
      return null
    }
    for (const language of ["cs", "sk"]) {
      window.localStorage.setItem("rafflink-language", language)
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      )
      cleanup()
    }
    expect(shown).toEqual(["1,5 minuty", "1,5 minúty"])
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
