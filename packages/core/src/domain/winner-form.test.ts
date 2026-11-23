import { describe, expect, it } from "bun:test"
import { parseWinnerAnswers, winnerAnswersOf, winnerFieldKindOf } from "./winner-form.ts"

describe("winnerAnswersOf", () => {
  it("keeps the own string fields of known kinds only", () => {
    const inherited = Object.create({ email: "a@b" })
    Object.assign(inherited, { name: "Ann", address: 5, phone: "1" })

    expect(winnerAnswersOf(inherited)).toEqual({ name: "Ann" })
    expect(winnerAnswersOf(null)).toEqual({})
  })
})

describe("winnerFieldKindOf", () => {
  it("names a known kind and nothing else", () => {
    expect(winnerFieldKindOf("platform-id")).toBe("platform-id")
    expect(winnerFieldKindOf("constructor")).toBeUndefined()
    expect(winnerFieldKindOf(1)).toBeUndefined()
  })
})

const config = { winnerAnswerMaxLength: 20 }

describe("parseWinnerAnswers", () => {
  it("keeps one trimmed answer per field of the form and drops keys the form does not ask for", () => {
    expect(
      parseWinnerAnswers(
        { name: "  Ann  ", email: "ann@example.com", address: "x", constructor: "y" },
        ["name", "email"],
        config,
      ),
    ).toEqual({ ok: true, value: { name: "Ann", email: "ann@example.com" } })
  })

  it("keeps the line breaks of an address", () => {
    expect(parseWinnerAnswers({ address: "Main 1\n123 City" }, ["address"], config)).toEqual({
      ok: true,
      value: { address: "Main 1\n123 City" },
    })
  })

  it("refuses a body that is not an object, a missing, blank, non-string or too long answer", () => {
    for (const [input, field, code] of [
      [null, "answers", "not-an-object"],
      [["Ann"], "answers", "not-an-object"],
      [{}, "name", "missing"],
      [{ name: null }, "name", "missing"],
      [{ name: 1 }, "name", "not-a-string"],
      [{ name: "   " }, "name", "blank"],
      [{ name: "a".repeat(21) }, "name", "too-long"],
    ] as const) {
      expect(parseWinnerAnswers(input, ["name"], config)).toEqual({
        ok: false,
        issue: { field, code },
      })
    }
  })

  it("accepts an answer at the maximum length after trimming", () => {
    expect(parseWinnerAnswers({ name: ` ${"a".repeat(20)} ` }, ["name"], config)).toEqual({
      ok: true,
      value: { name: "a".repeat(20) },
    })
  })

  it("does not read an answer from the prototype chain", () => {
    expect(parseWinnerAnswers(Object.create({ name: "Ann" }), ["name"], config)).toEqual({
      ok: false,
      issue: { field: "name", code: "missing" },
    })
  })

  it("refuses an e-mail without one @ between two non-blank parts", () => {
    for (const email of ["ann", "ann@", "@example.com", "a b@example.com", "a@b@c"]) {
      expect(parseWinnerAnswers({ email }, ["email"], config)).toEqual({
        ok: false,
        issue: { field: "email", code: "not-an-email" },
      })
    }
  })
})
