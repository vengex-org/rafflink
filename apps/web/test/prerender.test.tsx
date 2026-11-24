import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WebPrerenderConfig } from "@rafflink/core/config"
import type { OperatorJson } from "@rafflink/core/http/json"
import { legalDataElementId } from "@rafflink/core/lib/page-paths"
import { act, waitFor } from "@testing-library/react"
import { hydrateRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { prerender, writePrerender, type RenderedPage } from "../scripts/prerender.tsx"
import { AppRoutes } from "../src/app.tsx"
import { loadDictionary } from "../src/i18n/dictionaries.ts"
import { en } from "../src/i18n/en.ts"
import { formatDate } from "../src/i18n/i18n.tsx"
import { sk } from "../src/i18n/sk.ts"
import { templateUpdated } from "../src/pages/legal-page.tsx"
import { languages } from "../src/i18n/language.ts"
import { localizedPages, localizedPath, pageOfPath } from "../src/lib/routes.ts"
import { mockFetch, ok } from "./mock-fetch.ts"

// The app's own shell, without the stylesheet the test DOM would try to load when it parses a page.
const shell = (await Bun.file(join(import.meta.dir, "..", "index.html")).text()).replace(
  /<link rel="stylesheet"[^>]*>/,
  "",
)
const publicUrl = "https://rafflink.example"

const operator: OperatorJson = {
  name: "Example Operator",
  address: "1 Example Street, Example City",
  id: "12345678",
  email: "legal@example.com",
  legalUpdated: "2026-02-28",
}

const withOperator: WebPrerenderConfig = {
  publicUrl,
  operatorName: operator.name,
  operatorAddress: operator.address,
  operatorId: operator.id,
  operatorEmail: operator.email,
  legalUpdated: operator.legalUpdated,
}

const withoutOperator: WebPrerenderConfig = {
  publicUrl,
  operatorName: null,
  operatorAddress: null,
  operatorId: null,
  operatorEmail: null,
  legalUpdated: null,
}

const pageTitles = { home: "home.title", privacy: "privacy.title", terms: "terms.title" } as const

let dir: string
let root: Root | null = null
let added: Element[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rafflink-prerender-"))
  mockFetch({})
})

afterEach(() => {
  unmount()
  rmSync(dir, { recursive: true, force: true })
  mock.restore()
})

function unmount() {
  act(() => root?.unmount())
  root = null
  for (const element of added) element.remove()
  added = []
}

function filesIn(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .toSorted()
}

function parsePage(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

/** Puts the page's legal data into the head and its `#root` into the body, as the browser receives them, and hydrates it. */
async function hydrate({ path, html }: RenderedPage) {
  const parsed = parsePage(html)
  const data = parsed.getElementById(legalDataElementId)
  if (data !== null) {
    document.head.append(data)
    added.push(data)
  }
  const container = document.createElement("div")
  container.innerHTML = parsed.getElementById("root")?.innerHTML ?? ""
  document.body.append(container)
  added.push(container)
  const recoverable = mock<(error: unknown) => void>()
  await act(async () => {
    root = hydrateRoot(
      container,
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
      { onRecoverableError: recoverable },
    )
  })
  return { container, recoverable }
}

function session(value: OperatorJson | null) {
  mockFetch({
    "GET /api/session": () =>
      ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator: value }),
  })
}

describe("prerender", () => {
  it("writes each localized page in each language with its own head, a sitemap and a robots line, and nothing without PUBLIC_URL", async () => {
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\n")

    const pages = await writePrerender(dir, shell, withOperator)

    const expectedPaths = languages.flatMap((language) =>
      localizedPages.map((page) => localizedPath(language, page)),
    )
    expect(pages.map(({ path }) => path)).toEqual(expectedPaths)
    for (const { path, file, language } of pages) {
      const page = pageOfPath(path)?.page
      if (page === undefined) throw new Error(`${path} is no localized page`)
      const dictionary = await loadDictionary(language)
      const parsed = parsePage(await Bun.file(join(dir, file)).text())
      const head = parsed.head
      const alternates = [...head.querySelectorAll('link[rel="alternate"]')].map((link) => [
        link.getAttribute("hreflang"),
        link.getAttribute("href"),
      ])

      expect([
        path,
        parsed.documentElement.lang,
        head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        head.querySelector('meta[property="og:url"]')?.getAttribute("content"),
        head.querySelector('meta[property="og:image"]')?.getAttribute("content"),
        head.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
        head.querySelector('meta[name="robots"]'),
        head.querySelectorAll('script[type="application/ld+json"]').length,
        parsed.querySelector("#root h1")?.textContent,
      ]).toEqual([
        path,
        language,
        `${publicUrl}${path}`,
        `${publicUrl}${path}`,
        `${publicUrl}/og.png`,
        `${publicUrl}/og.png`,
        null,
        path === "/" ? 1 : 0,
        dictionary[pageTitles[page]],
      ])
      expect(alternates).toEqual([
        ...languages.map((code) => [code, `${publicUrl}${localizedPath(code, page)}`]),
        ["x-default", `${publicUrl}${localizedPath("en", page)}`],
      ])
    }
    const home = parsePage(await Bun.file(join(dir, "home.html")).text())
    const structured: unknown = JSON.parse(
      home.querySelector('script[type="application/ld+json"]')?.textContent ?? "",
    )
    expect(structured).toMatchObject({
      "@type": "SoftwareApplication",
      url: `${publicUrl}/`,
      offers: { price: "0" },
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
    })
    expect(structured).not.toHaveProperty("aggregateRating")
    const sitemap = await Bun.file(join(dir, "sitemap.xml")).text()
    expect([...sitemap.matchAll(/<loc>[^<]+<\/loc>/g)].map(([loc]) => loc)).toEqual(
      expectedPaths.map((path) => `<loc>${publicUrl}${path}</loc>`),
    )
    expect(sitemap.match(/<xhtml:link /g)?.length).toBe(expectedPaths.length * 10)
    expect(await Bun.file(join(dir, "robots.txt")).text()).toBe(
      `User-agent: *\n\nSitemap: ${publicUrl}/sitemap.xml\n`,
    )

    // A later build without PUBLIC_URL leaves the folder as a build that never prerendered.
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\n")
    expect(await writePrerender(dir, shell, null)).toEqual([])
    expect(filesIn(dir)).toEqual(["robots.txt"])
  })

  it("titles and describes each page in its own language", async () => {
    const pages = await prerender(shell, withoutOperator)

    const heads = pages
      .filter(({ language }) => language === "en" || language === "sk")
      .map(({ path, html }) => {
        const parsed = parsePage(html)
        const description = parsed.head.querySelector('meta[name="description"]')
        return [path, parsed.title, description?.getAttribute("content")]
      })
    expect(heads).toEqual([
      ["/", en["meta.home.title"], en["meta.home.description"]],
      ["/privacy", `${en["privacy.title"]} | Rafflink`, en["meta.privacy.description"]],
      ["/terms", `${en["terms.title"]} | Rafflink`, en["meta.terms.description"]],
      ["/sk/", sk["meta.home.title"], sk["meta.home.description"]],
      ["/sk/privacy", `${sk["privacy.title"]} | Rafflink`, sk["meta.privacy.description"]],
      ["/sk/terms", `${sk["terms.title"]} | Rafflink`, sk["meta.terms.description"]],
    ])
    for (const key of [
      "meta.home.title",
      "meta.home.description",
      "meta.privacy.description",
      "meta.terms.description",
    ] as const) {
      expect(sk[key]).not.toBe(en[key])
    }
  })

  it("hydrates every prerendered page without a mismatch and keeps the build's operator while the session agrees", async () => {
    session(operator)
    const errors = spyOn(console, "error")

    for (const page of await prerender(shell, withOperator)) {
      const { container, recoverable } = await hydrate(page)

      expect([page.path, recoverable.mock.calls.length]).toEqual([page.path, 0])
      if (page.name !== "home") {
        expect([page.path, container.textContent.includes(operator.email)]).toEqual([
          page.path,
          true,
        ])
      }
      unmount()
    }
    expect(errors).not.toHaveBeenCalled()
  })

  it("names the build's operator and date on a legal page before the session answers, and the session's when it names another", async () => {
    const answer = Promise.withResolvers<ReturnType<typeof ok>>()
    mockFetch({ "GET /api/session": () => answer.promise })
    const privacy = (await prerender(shell, withOperator)).find(({ path }) => path === "/privacy")
    if (privacy === undefined) throw new Error("no /privacy page")

    const { container } = await hydrate(privacy)

    expect(container.textContent).toContain("Example Operator, business ID 12345678")
    expect(container.textContent).toContain("Last updated: Feb 28, 2026")
    await act(async () => {
      answer.resolve(
        ok({
          streamer: null,
          signInPlatforms: ["twitch"],
          donateUrl: null,
          operator: { ...operator, name: "Other Operator", legalUpdated: null },
        }),
      )
    })
    await waitFor(() => expect(container.textContent).toContain("Other Operator"))
    expect(container.textContent).not.toContain("Example Operator")
    expect(container.textContent).toContain(
      `Last updated: ${formatDate("en", Date.parse(`${templateUpdated}T00:00`))}`,
    )
  })

  it("says the operator published no details on a legal page built without one", async () => {
    session(null)
    const terms = (await prerender(shell, withoutOperator)).find(({ path }) => path === "/terms")
    if (terms === undefined) throw new Error("no /terms page")

    expect(parsePage(terms.html).querySelector("#root")?.textContent).toContain(
      "has not published contact details",
    )
  })

  // A separate process: the app's modules are loaded in this one already, so a plugin here could swap nothing.
  it("prerenders the home page and the own pages of a deployment whose site module a preloaded plugin swaps", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "rafflink-public-"))
    writeFileSync(join(publicDir, "robots.txt"), "User-agent: *\n")
    writeFileSync(join(dir, "index.html"), shell)

    const build = Bun.spawnSync(
      [
        "bun",
        "--preload",
        join(import.meta.dir, "fixtures", "site-seam.ts"),
        join(import.meta.dir, "..", "scripts", "finish-build.ts"),
        dir,
        publicDir,
      ],
      { env: { ...process.env, PUBLIC_URL: publicUrl, OPERATOR_NAME: "", OPERATOR_EMAIL: "" } },
    )
    rmSync(publicDir, { recursive: true, force: true })

    expect(build.exitCode).toBe(0)
    const home = parsePage(await Bun.file(join(dir, "home.html")).text())
    const compare = parsePage(await Bun.file(join(dir, "de", "compare.html")).text())
    expect(home.querySelector("#root h1")?.textContent).toBe("Hosted home")
    expect([compare.title, compare.querySelector("#root h1")?.textContent]).toEqual([
      "Compare de",
      "Compare in de",
    ])
    expect(await Bun.file(join(dir, "sitemap.xml")).text()).toContain(
      `<loc>${publicUrl}/de/compare</loc>`,
    )
  })
})
