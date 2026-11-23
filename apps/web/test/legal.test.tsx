import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { OperatorJson } from "@rafflink/core/http/json"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import { dictionaries } from "../src/i18n/dictionaries.ts"
import { languages, type Language } from "../src/i18n/language.ts"
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

  it("list the profile picture URL among the data of streamers and of entrants in every language", () => {
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

  it("name the operator, address, business ID and contact in every language", async () => {
    withOperator(operator)
    for (const language of languages) {
      browserLanguage(language)
      for (const path of ["/privacy", "/terms"]) {
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
    const generic: Readonly<Record<Language, string>> = {
      en: "has not published contact details",
      sk: "nezverejnil kontaktné údaje",
      cs: "nezveřejnil kontaktní údaje",
    }
    for (const language of languages) {
      browserLanguage(language)

      const privacy = renderApp("/privacy")
      await privacy.findAllByText(new RegExp(generic[language]))
      expect(privacy.getByRole("article").textContent).not.toContain("{operator}")
      cleanup()

      const terms = renderApp("/terms")
      await terms.findAllByText(new RegExp(generic[language]))
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

  it("keep the operator placeholders as markers in the dictionaries, never as values", () => {
    for (const language of languages) {
      const texts = Object.values(dictionaries[language]).join("\n")
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

      await view.findByText("Last updated: Nov 22, 2026")
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
    const words: Readonly<Record<Language, { organizer: string; paid: string }>> = {
      en: { organizer: "Rafflink is not the organizer", paid: "Paid entry is not allowed" },
      sk: { organizer: "Rafflink nie je organizátor", paid: "Platené zapojenie nie je dovolené" },
      cs: { organizer: "Rafflink není pořadatel", paid: "Placené zapojení není dovoleno" },
    }
    for (const language of languages) {
      browserLanguage(language)
      const view = renderApp("/terms")

      const text = view.getByRole("article").textContent
      expect(text).toContain(words[language].organizer)
      expect(text).toContain(words[language].paid)
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
})
