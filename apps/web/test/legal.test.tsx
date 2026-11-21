import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, within } from "@testing-library/react"
import { dictionaries } from "../src/i18n/dictionaries.ts"
import { languages, type Language } from "../src/i18n/language.ts"
import { operator } from "../src/lib/operator.ts"
import { mockFetch } from "./mock-fetch.ts"
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

const titles: Readonly<Record<Language, { privacy: string; terms: string }>> = {
  en: { privacy: "Privacy policy", terms: "Terms of use" },
  sk: { privacy: "Zásady ochrany osobných údajov", terms: "Podmienky používania" },
  cs: { privacy: "Zásady ochrany osobních údajů", terms: "Podmínky používání" },
}

describe("legal pages", () => {
  for (const language of languages) {
    it(`render the privacy policy and the terms in ${language}`, () => {
      browserLanguage(language)

      const privacy = renderApp("/privacy")
      expect(privacy.getByRole("heading", { level: 1 }).textContent).toBe(titles[language].privacy)
      expect(privacy.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(5)
      cleanup()

      const terms = renderApp("/terms")
      expect(terms.getByRole("heading", { level: 1 }).textContent).toBe(titles[language].terms)
      expect(terms.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(5)
    })
  }

  it("list the Twitch profile picture URL among the data of streamers and of entrants in every language", () => {
    const pictureWords: Readonly<Record<Language, string>> = {
      en: "profile picture",
      sk: "profilového obrázka",
      cs: "profilového obrázku",
    }
    for (const language of languages) {
      expect(dictionaries[language]["privacy.data.i1"]).toContain(pictureWords[language])
      expect(dictionaries[language]["privacy.data.i3"]).toContain(pictureWords[language])
    }
  })

  it("fill the operator, address and contact from the one config in every language", () => {
    for (const language of languages) {
      browserLanguage(language)
      for (const path of ["/privacy", "/terms"]) {
        const view = renderApp(path)

        const text = view.getByRole("article").textContent
        expect(text).toContain(operator.name)
        expect(text).toContain(operator.address)
        expect(text).toContain(operator.id)
        expect(text).toContain(operator.contactEmail)
        cleanup()
      }
    }
  })

  it("keep the operator placeholders as markers in the dictionaries, never as values", () => {
    const markers = ["{operatorName}", "{operatorAddress}", "{operatorId}", "{contactEmail}"]
    for (const language of languages) {
      const texts = Object.values(dictionaries[language]).join("\n")
      for (const marker of markers) expect(texts).toContain(marker)
      expect(texts).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })

  it("show the update date on the same day in a zone behind UTC", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    process.env.TZ = "America/Los_Angeles"
    try {
      browserLanguage("en-US")
      const view = renderApp("/privacy")

      expect(view.getByRole("article").textContent).toContain("Nov 21, 2026")
    } finally {
      process.env.TZ = zone
    }
  })

  it("link the source repository in the terms", () => {
    const view = renderApp("/terms")

    const link = within(view.getByRole("article")).getByRole("link", {
      name: "https://github.com/vengex-org/rafflink",
    })

    expect(link.getAttribute("href")).toBe("https://github.com/vengex-org/rafflink")
  })

  it("name the cookies and say no consent banner is needed", () => {
    browserLanguage("en-US")
    const view = renderApp("/privacy")

    const text = view.getByRole("article").textContent
    for (const cookie of ["rl_streamer", "rl_viewer", "rl_oauth_", "rl_pending_"]) {
      expect(text).toContain(cookie)
    }
    expect(text).toContain("no consent banner is shown")
    expect(text).toContain("never stored or logged")
  })

  it("follow the language switch", () => {
    browserLanguage("en-US")
    const view = renderApp("/privacy")

    fireEvent.click(view.getByRole("radio", { name: "Čeština" }))

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(titles.cs.privacy)
    expect(document.documentElement.lang).toBe("cs")
  })

  it("keep the routes case sensitive so a giveaway code like TERMS opens the giveaway page", () => {
    const view = renderApp("/TERMS")

    expect(view.queryByRole("article")).toBeNull()
    expect(view.queryByRole("heading", { name: "Terms of use" })).toBeNull()
  })

  it("leave the link to the other text to the footer", () => {
    const view = renderApp("/privacy")

    const footer = within(view.getByRole("navigation", { name: "Legal" }))

    expect(footer.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms")
    expect(within(view.getByRole("article")).queryByRole("link", { name: "Terms" })).toBeNull()
  })
})

describe("legal footer links", () => {
  it("sit in the home page footer", () => {
    const view = renderApp("/")

    const footer = within(view.getByRole("navigation", { name: "Footer" }))

    expect(footer.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy")
    expect(footer.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms")
  })

  it("sit in the footer of every other page with the shared layout", () => {
    for (const path of ["/demo", "/privacy"]) {
      const view = renderApp(path)

      const footer = within(view.getByRole("navigation", { name: "Legal" }))

      expect(footer.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy")
      expect(footer.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms")
      cleanup()
    }
  })

  it("appear once on the home page", () => {
    const view = renderApp("/")

    expect(view.queryByRole("navigation", { name: "Legal" })).toBeNull()
  })
})
