import { describe, expect, it } from "bun:test"
import { isLanguage, languages } from "./languages.ts"

describe("languages", () => {
  it("knows every listed language", () => {
    expect(languages.filter(isLanguage)).toEqual([...languages])
  })

  it.each(["", "EN", "de-DE", "xx", "constructor", "__proto__", " en"])("rejects %p", (text) => {
    expect(isLanguage(text)).toBe(false)
  })
})
