import { describe, expect, it } from "bun:test"
import { initialsOf } from "../src/lib/initials.ts"

describe("initialsOf", () => {
  it("takes the first letters of the first two words of a login", () => {
    expect(initialsOf("mira_vex")).toBe("MV")
    expect(initialsOf("matej-kral-77")).toBe("MK")
    expect(initialsOf("Ada Lovelace")).toBe("AL")
  })

  it("takes the first two letters of a single word", () => {
    expect(initialsOf("grimfrost")).toBe("GR")
    expect(initialsOf("x")).toBe("X")
    expect(initialsOf("nightjar_77")).toBe("NI")
  })

  it("keeps a letter outside the basic plane whole", () => {
    expect(initialsOf("𝓐da")).toBe("𝓐D")
  })

  it("uses the digits of a login that has no letter", () => {
    expect(initialsOf("12345")).toBe("12")
    expect(initialsOf("7_9")).toBe("79")
  })

  it("skips separators at the edges and still finds a word", () => {
    expect(initialsOf("__vex__")).toBe("VE")
    expect(initialsOf("_a_")).toBe("A")
  })

  it("falls back to a placeholder when nothing printable is left", () => {
    expect(initialsOf("")).toBe("?")
    expect(initialsOf(" _- ")).toBe("?")
  })
})
