import { describe, expect, it } from "bun:test"
import { codeAlphabet, codeLength } from "./codes.ts"
import { languages } from "./languages.ts"
import {
  alternates,
  giveawayPath,
  localizedPages,
  localizedPath,
  pageOfPath,
  prerenderFile,
  verifyPath,
} from "./page-paths.ts"

describe("page paths", () => {
  it("writes the pages of a giveaway under its code", () => {
    expect(giveawayPath("ABCDE")).toBe("/ABCDE")
    expect(verifyPath("ABCDE")).toBe("/ABCDE/verify")
  })

  it("encodes a code that holds a reserved character", () => {
    expect(giveawayPath("A/B")).toBe("/A%2FB")
  })
})

describe("localized pages", () => {
  const everyAddress = languages.flatMap((language) =>
    localizedPages.map((page) => ({ language, page })),
  )

  it("puts the source language at the root and every other language under its code", () => {
    expect(localizedPages.map((page) => localizedPath("en", page))).toEqual([
      "/",
      "/privacy",
      "/terms",
    ])
    expect(localizedPages.map((page) => localizedPath("de", page))).toEqual([
      "/de/",
      "/de/privacy",
      "/de/terms",
    ])
  })

  it("reads every language and page back from its address", () => {
    for (const address of everyAddress) {
      expect(pageOfPath(localizedPath(address.language, address.page))).toEqual(address)
    }
  })

  it("reads a language home without its slash and a page with one", () => {
    expect(pageOfPath("/de")).toEqual({ language: "de", page: "home" })
    expect(pageOfPath("/de/")).toEqual({ language: "de", page: "home" })
    expect(pageOfPath("/de/privacy/")).toEqual({ language: "de", page: "privacy" })
    expect(pageOfPath("")).toEqual({ language: "en", page: "home" })
  })

  it.each([
    "/en/",
    "/en/privacy",
    "/DE/",
    "/de/Privacy",
    "/de/home",
    "/home",
    "/de/privacy/more",
    "/xx/",
    "/constructor",
    "/__proto__/",
    "/dashboard",
    "/ABCDE",
  ])("finds no localized page at %s", (pathname) => {
    expect(pageOfPath(pathname)).toBeNull()
  })

  it("writes each page to its own file and never to the app's shell", () => {
    const files = everyAddress.map(({ language, page }) => prerenderFile(language, page))

    expect(new Set(files).size).toBe(everyAddress.length)
    expect(files).not.toContain("index.html")
    expect(prerenderFile("de", "home")).toBe("de/index.html")
    expect(prerenderFile("de", "privacy")).toBe("de/privacy.html")
    expect(prerenderFile("en", "terms")).toBe("terms.html")
  })

  it("lists every language as an alternate, and the source language as x-default", () => {
    expect(alternates("privacy")).toEqual([
      ...languages.map((language) => ({
        hreflang: language,
        path: localizedPath(language, "privacy"),
      })),
      { hreflang: "x-default", path: "/privacy" },
    ])
  })

  it("never reads a language code as a giveaway code", () => {
    const code = new RegExp(`^[${codeAlphabet}]{${codeLength}}$`)

    expect(languages.filter((language) => code.test(language.toUpperCase()))).toEqual([])
  })
})
