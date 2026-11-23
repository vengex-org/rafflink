import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { OperatorJson } from "@rafflink/core/http/json"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { loadDictionary } from "../src/i18n/dictionaries.ts"
import { languages, type Language } from "../src/i18n/language.ts"
import { localizedPath } from "../src/lib/routes.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
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

const operator = {
  name: "Example Operator",
  address: "1 Example Street, Example City",
  id: "12345678",
  email: "legal@example.com",
  legalUpdated: null,
} satisfies OperatorJson

const minimalOperator: OperatorJson = {
  name: "Example Operator",
  address: null,
  id: null,
  email: "legal@example.com",
  legalUpdated: "2026-02-28",
}

function withOperator(value: OperatorJson) {
  mockFetch({
    "GET /api/session": () =>
      ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator: value }),
  })
}

/** A session call that answers when the test says so. */
function delayedSession() {
  const gate = Promise.withResolvers<Reply>()
  mockFetch({ "GET /api/session": () => gate.promise })
  return gate.resolve
}

/** The entries of a per-language expectation, so a new dictionary needs no line in this file. */
function eachLanguage<T>(expected: Readonly<Partial<Record<Language, T>>>): [Language, T][] {
  return languages.flatMap((language) => {
    const value = expected[language]
    return value === undefined ? [] : [[language, value]]
  })
}

const titles = eachLanguage({
  en: { privacy: "Privacy policy", terms: "Terms of use" },
  sk: { privacy: "Zásady ochrany osobných údajov", terms: "Podmienky používania" },
  cs: { privacy: "Zásady ochrany osobních údajů", terms: "Podmínky používání" },
  de: { privacy: "Datenschutzerklärung", terms: "Nutzungsbedingungen" },
})

describe("legal pages", () => {
  for (const [language, title] of titles) {
    it(`render the privacy policy and the terms in ${language}`, () => {
      const privacy = renderApp(localizedPath(language, "privacy"))
      expect(privacy.getByRole("heading", { level: 1 }).textContent).toBe(title.privacy)
      expect(privacy.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(5)
      cleanup()

      const terms = renderApp(localizedPath(language, "terms"))
      expect(terms.getByRole("heading", { level: 1 }).textContent).toBe(title.terms)
      expect(terms.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(5)
    })
  }

  it("say in every translation, and only there, that the English version prevails", async () => {
    for (const language of languages) {
      const translated = (await loadDictionary(language))["legal.englishPrevails"]
      for (const path of [localizedPath(language, "privacy"), localizedPath(language, "terms")]) {
        const view = renderApp(path)

        const text = view.getByRole("article").textContent
        expect([language, path, text.includes(translated)]).toEqual([
          language,
          path,
          language !== "en",
        ])
        cleanup()
      }
    }
  })

  it("link YouTube's terms, Google's privacy policy and the page that removes Google access", () => {
    const privacy = renderApp("/privacy")
    const privacyLinks = privacy.getAllByRole("link").map((link) => link.getAttribute("href"))
    cleanup()
    const terms = renderApp("/terms")
    const termsLinks = terms.getAllByRole("link").map((link) => link.getAttribute("href"))

    expect(privacyLinks).toEqual(
      expect.arrayContaining([
        "https://www.youtube.com/t/terms",
        "https://policies.google.com/privacy",
        "https://myaccount.google.com/permissions",
      ]),
    )
    expect(termsLinks).toContain("https://www.youtube.com/t/terms")
  })

  it("list the profile picture URL among the data of streamers and of entrants in every language", async () => {
    const pictureWords = eachLanguage({
      en: "profile picture",
      sk: "profilového obrázka",
      cs: "profilového obrázku",
      de: "Profilbild",
    })
    for (const [language, words] of pictureWords) {
      const dictionary = await loadDictionary(language)
      expect(dictionary["privacy.data.i1"]).toContain(words)
      expect(dictionary["privacy.data.i3"]).toContain(words)
    }
  })

  it("name the operator, address, business ID and contact in every language", async () => {
    withOperator(operator)
    for (const language of languages) {
      for (const path of [localizedPath(language, "privacy"), localizedPath(language, "terms")]) {
        const view = renderApp(path)

        await view.findByText(new RegExp(operator.name))
        const text = view.getByRole("article").textContent
        expect(text).toContain(operator.address)
        expect(text).toContain(operator.id)
        expect(text).toContain(operator.email)
        expect(text).not.toContain("has not published contact details")
        cleanup()
      }
    }
  })

  it("leave out the business ID and the address an operator did not set", async () => {
    withOperator(minimalOperator)
    browserLanguage("en-US")

    const view = renderApp("/privacy")

    await view.findByText(/controller of your personal data on this instance is Example Operator\./)
    const text = view.getByRole("article").textContent
    expect(text).not.toContain("business ID")
    expect(text).toContain("Write to legal@example.com.")
  })

  it("say the operator has published no details when none is configured, in every language", async () => {
    mockFetch({})
    const generic = eachLanguage({
      en: "has not published contact details",
      sk: "nezverejnil kontaktné údaje",
      cs: "nezveřejnil kontaktní údaje",
      de: "keine Kontaktdaten veröffentlicht",
    })
    for (const [language, words] of generic) {
      const privacy = renderApp(localizedPath(language, "privacy"))
      await privacy.findAllByText(new RegExp(words))
      expect(privacy.getByRole("article").textContent).not.toContain("{operator}")
      cleanup()

      const terms = renderApp(localizedPath(language, "terms"))
      await terms.findAllByText(new RegExp(words))
      cleanup()
    }
  })

  it("tell a visitor of an instance without an operator that the one who shared the link may not be the operator", async () => {
    mockFetch({})
    browserLanguage("en-US")

    const privacy = renderApp("/privacy")

    await privacy.findByText(/may not be the operator/)
    expect(privacy.getByRole("article").textContent).not.toContain("We answer within one month")
    cleanup()
    const terms = renderApp("/terms")
    await terms.findByText(/may not be the operator/)
  })

  it("show no operator, contact, date or generic text while the session call is open", async () => {
    const answer = delayedSession()
    browserLanguage("en-US")

    const view = renderApp("/privacy")

    const text = () => view.getByRole("article").textContent
    expect(text()).not.toContain("controller of your personal data")
    expect(text()).not.toContain("has not published contact details")
    expect(text()).not.toContain("Write to")
    expect(text()).not.toContain("Last updated")
    await act(async () => {
      answer(ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator }))
    })
    await view.findByText(/Last updated/)
    expect(text()).toContain("legal@example.com")
  })

  it("say the details could not be loaded when the session call fails, never claim an operator or none, and retry", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    let calls = 0
    mockFetch({
      "GET /api/session": () => {
        calls += 1
        return calls === 1
          ? { status: 500, body: null }
          : ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator })
      },
    })
    browserLanguage("en-US")

    const view = renderApp("/terms")

    await view.findByText(/could not be loaded/)
    const text = () => view.getByRole("article").textContent
    expect(text()).not.toContain("has not published contact details")
    expect(text()).not.toContain("Questions about these terms")
    expect(text()).not.toContain("Last updated")

    fireEvent.click(view.getByRole("button", { name: "Try again" }))

    await view.findByText(/This instance is run by Example Operator/)
    expect(text()).not.toContain("could not be loaded")
  })

  it("keep the operator placeholders as markers in the dictionaries, never as values", async () => {
    for (const language of languages) {
      const texts = Object.values(await loadDictionary(language)).join("\n")
      expect(texts).toContain("{operator}")
      expect(texts).toContain("{contact}")
      expect(texts).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })

  it("show the update date on the same day in a zone behind UTC", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    process.env.TZ = "America/Los_Angeles"
    try {
      browserLanguage("en-US")
      const view = renderApp("/privacy")

      await view.findByText("Last updated: Nov 23, 2026")
    } finally {
      process.env.TZ = zone
    }
  })

  it("show the date the operator configured instead of the template date", async () => {
    withOperator(minimalOperator)
    browserLanguage("en-US")

    const view = renderApp("/terms")

    await view.findByText("Last updated: Feb 28, 2026")
  })

  it("link the source repository in the terms", () => {
    const view = renderApp("/terms")

    const link = within(view.getByRole("article")).getByRole("link", {
      name: "https://github.com/vengex-org/rafflink",
    })

    expect(link.getAttribute("href")).toBe("https://github.com/vengex-org/rafflink")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener")
  })

  it("name the streamer as the organizer and forbid paid entry in the terms in every language", () => {
    const words = eachLanguage({
      en: { organizer: "Rafflink is not the organizer", paid: "Paid entry is not allowed" },
      sk: { organizer: "Rafflink nie je organizátor", paid: "Platené zapojenie nie je dovolené" },
      cs: { organizer: "Rafflink není pořadatel", paid: "Placené zapojení není dovoleno" },
      de: {
        organizer: "Rafflink ist nicht der Veranstalter",
        paid: "Kostenpflichtige Teilnahme ist nicht erlaubt",
      },
    })
    for (const [language, expected] of words) {
      const view = renderApp(localizedPath(language, "terms"))

      const text = view.getByRole("article").textContent
      expect(text).toContain(expected.organizer)
      expect(text).toContain(expected.paid)
      cleanup()
    }
  })

  it("list the block list as personal data of the blocked person and how long it is kept", () => {
    browserLanguage("en-US")
    const view = renderApp("/privacy")

    const text = view.getByRole("article").textContent
    expect(text).toContain("Blocked accounts: a streamer can block accounts from their giveaways.")
    expect(text).toContain("the blocked person's platform user ID and login name")
    expect(text).toContain(
      "until the streamer removes it on the dashboard or deletes their account",
    )
    expect(text).toContain(
      "the platform user IDs of the winners of their earlier giveaways are copied into the new giveaway's room",
    )
    expect(text).toContain(
      "are deleted with that giveaway's entries, at most 30 days after it closes",
    )
    expect(text).not.toContain("Nothing new is stored")
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

  it("follow the language switch to the address of the text in the picked language, and store the choice", async () => {
    browserLanguage("en-US")
    const view = renderApp("/privacy")

    fireEvent.click(view.getByRole("radio", { name: "Čeština" }))

    expect(
      await view.findByRole("heading", { level: 1, name: "Zásady ochrany osobních údajů" }),
    ).toBeTruthy()
    await waitFor(() => expect(document.documentElement.lang).toBe("cs"))
    expect(view.address()).toBe("/cs/privacy")
    expect(window.localStorage.getItem("rafflink-language")).toBe("cs")
  })

  it("show the language of the address, not the stored choice or the browser's", () => {
    window.localStorage.setItem("rafflink-language", "de")
    browserLanguage("sk-SK")

    const english = renderApp("/privacy")
    expect(english.getByRole("heading", { level: 1 }).textContent).toBe("Privacy policy")
    cleanup()

    const czech = renderApp("/cs/terms")
    expect(czech.getByRole("heading", { level: 1 }).textContent).toBe("Podmínky používání")
    expect(window.localStorage.getItem("rafflink-language")).toBe("de")
  })

  it("follow the address back to another language without storing it", async () => {
    const view = renderApp("/de/privacy")
    fireEvent.click(view.getByRole("radio", { name: "Čeština" }))
    await view.findByRole("heading", { level: 1, name: "Zásady ochrany osobních údajů" })

    view.go("/de/terms")

    expect(await view.findByRole("heading", { level: 1, name: "Nutzungsbedingungen" })).toBeTruthy()
    expect(window.localStorage.getItem("rafflink-language")).toBe("cs")
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
    for (const path of ["/verify", "/privacy"]) {
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

  it("point to the texts and the home page in the language shown", () => {
    const home = renderApp("/de/")
    const homeFooter = within(home.getByRole("navigation", { name: "Fußzeile" }))
    expect(homeFooter.getByRole("link", { name: "Datenschutz" }).getAttribute("href")).toBe(
      "/de/privacy",
    )
    expect(homeFooter.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(
      "/de/terms",
    )
    expect(home.queryByRole("navigation", { name: "Rechtliches" })).toBeNull()
    cleanup()

    window.localStorage.setItem("rafflink-language", "de")
    for (const path of ["/de/privacy", "/verify"]) {
      const view = renderApp(path)
      const footer = within(view.getByRole("navigation", { name: "Rechtliches" }))
      expect([
        path,
        footer.getByRole("link", { name: "Datenschutz" }).getAttribute("href"),
      ]).toEqual([path, "/de/privacy"])
      expect(footer.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(
        "/de/terms",
      )
      expect(view.getByRole("link", { name: "Rafflink" }).getAttribute("href")).toBe("/de/")
      cleanup()
    }
  })
})
