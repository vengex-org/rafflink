import { describe, expect, it } from "bun:test"
import { fuzzyMatch } from "../src/lib/fuzzy-match.ts"

function score(query: string, text: string): number {
  const found = fuzzyMatch(query, text)
  if (found === null) throw new Error(`${query} does not match ${text}`)
  return found.score
}

describe("fuzzyMatch", () => {
  it("ranks prefix, word start, contiguous and scattered matches in that order", () => {
    const ranked = [
      score("ada", "Adam"),
      score("ada", "Zoe_Ada"),
      score("ada", "Canada"),
      score("ada", "ArDeA"),
    ]

    expect(ranked).toEqual(ranked.toSorted((a, b) => b - a))
    expect(new Set(ranked).size).toBe(4)
  })

  it("treats a capital after a small letter as the start of a word", () => {
    expect(score("doe", "JohnDoe")).toBeGreaterThan(score("doe", "Johndoe"))
  })

  it("prefers the shorter text within a tier and the tighter spread among scattered matches", () => {
    expect(score("ad", "Ada")).toBeGreaterThan(score("ad", "Adalbert"))
    expect(score("ae", "Abe")).toBeGreaterThan(score("ae", "Abcdefe"))
  })

  it("ignores case in the query and in the text", () => {
    expect(fuzzyMatch("ADA", "ada")).toEqual(fuzzyMatch("ada", "ADA"))
  })

  it("reports the matched positions", () => {
    expect(fuzzyMatch("ada", "Zoe_Ada")?.positions).toEqual([4, 5, 6])
    expect(fuzzyMatch("ae", "Abe")?.positions).toEqual([0, 2])
  })

  it("counts positions in whole characters, not code units", () => {
    expect(fuzzyMatch("b", "😀b")?.positions).toEqual([1])
  })

  it("matches letters beyond ASCII", () => {
    expect(fuzzyMatch("ľub", "Ľubo")?.positions).toEqual([0, 1, 2])
  })

  it("finds nothing for letters out of order, a missing letter or a query longer than the text", () => {
    expect(fuzzyMatch("ba", "ab")).toBeNull()
    expect(fuzzyMatch("abz", "abc")).toBeNull()
    expect(fuzzyMatch("abcd", "abc")).toBeNull()
  })

  it("finds nothing for an empty query or an empty text", () => {
    expect(fuzzyMatch("", "abc")).toBeNull()
    expect(fuzzyMatch("a", "")).toBeNull()
  })

  it("does not treat prototype keys as special", () => {
    expect(fuzzyMatch("constructor", "constructor")?.positions.length).toBe(11)
    expect(fuzzyMatch("__proto__", "x")).toBeNull()
  })
})
