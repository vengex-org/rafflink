import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { loadDictionary } from "../src/i18n/dictionaries.ts"
import { de } from "../src/i18n/de.ts"
import { en } from "../src/i18n/en.ts"
import { languages } from "../src/i18n/language.ts"
import { localizedPath, staticSegments, staticSubSegments } from "../src/lib/routes.ts"
import { dashboardGiveaway, giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { chooseLanguage } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
  window.localStorage.clear()
  document.documentElement.lang = "en"
})

const giveawayRoutes = { "GET /api/g/ABCDE": () => ok(giveaway) }
const verifyMissing = { "GET /api/g/ABCDE/verify": () => ({ status: 404, body: null }) }

describe("old giveaway links", () => {
  it.each([
    ["/g/ABCDE", "/ABCDE"],
    ["/g/abcde", "/ABCDE"],
    ["/g/ABCDE/verify", "/ABCDE/verify"],
    ["/g/abcde/verify?run=1", "/ABCDE/verify?run=1"],
    ["/g/ABCDE?entry=closed", "/ABCDE"],
  ])("opens %s at %s, replacing the history entry", async (old, canonical) => {
    mockFetch({ ...giveawayRoutes, ...verifyMissing })

    const view = renderApp(old)

    await waitFor(() => expect(view.address()).toBe(canonical))
    view.back()
    expect(view.address()).toBe(canonical)
  })
})

describe("giveaway code in the address", () => {
  it.each(["/abcde", "/AbCdE"])("replaces %s with the code in capitals", async (typed) => {
    mockFetch(giveawayRoutes)

    const view = renderApp(typed)

    await waitFor(() => expect(view.address()).toBe("/ABCDE"))
    expect(await view.findByRole("heading", { level: 1 })).toBeTruthy()
  })

  it("keeps the query and replaces the code of the verify page too", async () => {
    mockFetch({ ...giveawayRoutes, ...verifyMissing })

    const view = renderApp("/abcde/verify?run=1")

    await waitFor(() => expect(view.address()).toBe("/ABCDE/verify?run=1"))
  })

  it.each(["/ABCD", "/ABCDEF", "/OOOOO", "/ABCDE0/verify"])(
    "answers %s with the page 404 and no request for a giveaway",
    async (path) => {
      const requests = mockFetch({})

      const view = renderApp(path)

      expect(await view.findByRole("heading", { name: "Page not found" })).toBeTruthy()
      expect(requests.filter((request) => request.route.includes("/api/g/"))).toEqual([])
    },
  )

  it("answers a well-formed code nobody uses with the giveaway 404", async () => {
    mockFetch({ "GET /api/g/ZZZZZ": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/ZZZZZ")

    expect(await view.findByRole("heading", { name: "Giveaway not found" })).toBeTruthy()
  })
})

describe("static pages", () => {
  it.each([
    ["/privacy/", "/privacy"],
    ["/terms//", "/terms"],
    ["/dashboard/new/?step=1", "/dashboard/new?step=1"],
    ["/ABCDE/", "/ABCDE"],
  ])("replaces the trailing slash of %s", async (typed, expected) => {
    mockFetch({ ...giveawayRoutes, "GET /api/dash/giveaways": () => ok({ giveaways: [] }) })

    const view = renderApp(typed)

    await waitFor(() => expect(view.address()).toBe(expected))
  })

  it.each([
    ["/Privacy", "/privacy"],
    ["/PRIVACY", "/privacy"],
    ["/Terms", "/terms"],
    ["/Verify", "/verify"],
    ["/Dashboard", "/dashboard"],
    ["/Admin", "/admin"],
    ["/LIVE/gid-1", "/live/gid-1"],
    ["/Dashboard/Created/AbC", "/dashboard/created/AbC"],
    ["/dashboard/NEW?step=2", "/dashboard/new?step=2"],
    ["/Dashboard/Settings", "/dashboard/settings"],
    ["/ABCDE/Verify", "/ABCDE/verify"],
    ["/G/abcde/VERIFY", "/ABCDE/verify"],
  ])("replaces %s with the lowercase path %s, never a giveaway code", async (typed, expected) => {
    const requests = mockFetch({})

    const view = renderApp(typed)

    await waitFor(() => expect(view.address()).toBe(expected))
    expect(requests.filter((request) => request.route.includes("/api/g/"))).toEqual([])
  })

  it("keeps a giveaway code in capitals even when it spells a page name", async () => {
    mockFetch({ "GET /api/g/TERMS": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/TERMS")

    expect(await view.findByRole("heading", { name: "Giveaway not found" })).toBeTruthy()
    expect(view.address()).toBe("/TERMS")
  })

  it("opens the legal page spelled in lowercase", async () => {
    mockFetch({})

    const view = renderApp("/terms")

    expect(await view.findByRole("heading", { level: 1 })).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Page not found" })).toBeNull()
  })
})

describe("canonical spelling", () => {
  it("knows every fixed word of every static route in app.tsx", () => {
    const source = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8")
    const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1] ?? "")
    const words = paths.flatMap((path) =>
      path
        .split("/")
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => segment !== "" && segment !== "*" && !segment.startsWith(":")),
    )

    expect(words.length).toBeGreaterThan(8)
    for (const { segment, index } of words) {
      const known = index === 0 ? staticSegments : [...staticSegments, ...staticSubSegments]
      expect([segment, known]).toEqual([segment, expect.arrayContaining([segment])])
    }
  })
})

describe("localized pages", () => {
  it("open the home page in every language at its address", async () => {
    mockFetch({})
    for (const language of languages) {
      const dictionary = await loadDictionary(language)
      const view = renderApp(localizedPath(language, "home"))

      expect([language, view.getByRole("heading", { level: 1 }).textContent]).toEqual([
        language,
        dictionary["home.title"],
      ])
      expect(document.documentElement.lang).toBe(language)
      cleanup()
    }
  })

  it("keep the slash of a language's home page, which its folder is served with", async () => {
    mockFetch({})
    const view = renderApp("/de/")

    await act(async () => {})
    expect(view.address()).toBe("/de/")
  })

  it.each([
    ["/de", "/de/"],
    ["/DE", "/de/"],
    ["/de/privacy/", "/de/privacy"],
    ["/DE/terms", "/de/terms"],
    ["/DE/PRIVACY", "/de/privacy"],
    ["/privacy/", "/privacy"],
    ["/en/", "/"],
    ["/en/privacy", "/privacy"],
  ])("open %s at %s", async (typed, canonical) => {
    mockFetch({})
    const view = renderApp(typed)

    await waitFor(() => expect(view.address()).toBe(canonical))
    const heading = (await view.findByRole("heading", { level: 1 })).textContent
    expect([en["notFound.page"], de["notFound.page"]]).not.toContain(heading)
  })

  it("answer a page a language does not have with the page 404", async () => {
    mockFetch({})
    const view = renderApp("/de/dashboard")

    expect(await view.findByRole("heading", { level: 1 })).toHaveProperty(
      "textContent",
      en["notFound.page"],
    )
  })
})

describe("one-time parameters", () => {
  it("shows why a sign-in failed and removes ?signin= so a reload does not repeat it", async () => {
    mockFetch({})

    const view = renderApp("/?signin=try-again")

    expect(view.getByRole("alert").textContent).toBe(
      "The streaming platform did not answer. Please try again.",
    )
    await waitFor(() => expect(view.address()).toBe("/"))
    expect(view.getByRole("alert").textContent).toBe(
      "The streaming platform did not answer. Please try again.",
    )
  })

  it("keeps the other parameters when it removes one", async () => {
    mockFetch({})

    const view = renderApp("/?signin=try-again&ref=giveaway")

    await waitFor(() => expect(view.address()).toBe("/?ref=giveaway"))
  })

  it("picks the language of ?lang=, stores it and opens the page at its address in that language", async () => {
    mockFetch({})

    const view = renderApp("/?lang=sk")

    expect(
      await view.findByRole("heading", {
        name: "Férové súťaže, žrebované naživo na streame.",
      }),
    ).toBeTruthy()
    expect(window.localStorage.getItem("rafflink-language")).toBe("sk")
    await waitFor(() => expect(document.documentElement.lang).toBe("sk"))
    await waitFor(() => expect(view.address()).toBe("/sk/"))
  })

  it("removes ?lang= on a page that is not localized and keeps the address", async () => {
    mockFetch({})

    const view = renderApp("/verify?lang=sk")

    await waitFor(() => expect(view.address()).toBe("/verify"))
    await waitFor(() => expect(document.documentElement.lang).toBe("sk"))
    expect(window.localStorage.getItem("rafflink-language")).toBe("sk")
  })

  it("lets the menu change the language again after a ?lang= link", async () => {
    mockFetch({})
    const view = renderApp("/?lang=sk")
    await view.findByRole("heading", {
      name: "Férové súťaže, žrebované naživo na streame.",
    })
    await waitFor(() => expect(view.address()).toBe("/sk/"))

    chooseLanguage(view.container, "English")

    expect(
      await view.findByRole("heading", { name: "Fair giveaways, drawn live on stream." }),
    ).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/"))
  })

  it("applies a ?lang= link followed later in the page, though the language was chosen again since", async () => {
    mockFetch({})
    const view = renderApp("/?lang=sk")
    await view.findByRole("heading", {
      name: "Férové súťaže, žrebované naživo na streame.",
    })
    await waitFor(() => expect(view.address()).toBe("/sk/"))
    chooseLanguage(view.container, "English")
    await view.findByRole("heading", { name: "Fair giveaways, drawn live on stream." })
    await waitFor(() => expect(view.address()).toBe("/"))

    view.go("/?lang=sk")

    expect(
      await view.findByRole("heading", {
        name: "Férové súťaže, žrebované naživo na streame.",
      }),
    ).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/sk/"))
  })

  it("ignores a language it does not offer and still removes the parameter", async () => {
    mockFetch({})

    const view = renderApp("/?lang=klingon")

    await waitFor(() => expect(view.address()).toBe("/"))
    expect(window.localStorage.getItem("rafflink-language")).toBeNull()
    expect(document.documentElement.lang).toBe("en")
  })

  it("shows the outcome of ?entry= and removes it from the address at once", async () => {
    mockFetch(giveawayRoutes)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=subs-only")

    expect(await view.findByRole("heading", { name: "You cannot enter" })).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/ABCDE"))
    expect(view.getByRole("heading", { name: "You cannot enter" })).toBeTruthy()
  })
})

describe("page fade", () => {
  const finished = Promise.resolve()
  let started = 0
  const original = Reflect.get(document, "startViewTransition")

  beforeEach(() => {
    started = 0
    Reflect.set(document, "startViewTransition", (update: unknown) => {
      started++
      const callback = typeof update === "function" ? update : Reflect.get(Object(update), "update")
      if (typeof callback === "function") callback()
      return { finished, ready: finished, updateCallbackDone: finished, skipTransition() {} }
    })
  })
  afterEach(() => {
    Reflect.set(document, "startViewTransition", original)
  })

  it("fades when the path changes", async () => {
    mockFetch({})
    const view = renderApp("/privacy")
    await view.findByRole("heading", { level: 1 })

    fireEvent.click(view.getAllByRole("link", { name: "Terms" })[0] ?? document.body)
    await waitFor(() => expect(view.address()).toBe("/terms"))

    expect(started).toBeGreaterThan(0)
  })

  it("does not fade when only the query changes", async () => {
    mockFetch({ "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }) })
    const view = renderApp("/dashboard/new")
    await view.findByText("Step 1 of 3: Basics")
    const before = started

    fireEvent.click(view.getByRole("button", { name: "Next" }))
    await view.findByText("Step 2 of 3: Entry rules")

    expect(view.address()).toBe("/dashboard/new?step=2")
    expect(started).toBe(before)
  })
})
