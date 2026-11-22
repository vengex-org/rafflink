import { describe, expect, it } from "bun:test"
import { parseReferral } from "./referral.ts"

describe("parseReferral", () => {
  it("accepts lower-case letters, digits and hyphens up to 32 characters", () => {
    expect(parseReferral("reddit-2026")).toBe("reddit-2026")
    expect(parseReferral("a")).toBe("a")
    expect(parseReferral("a".repeat(32))).toBe("a".repeat(32))
  })

  it("ignores an absent, empty, too long or differently written value", () => {
    for (const raw of [
      null,
      "",
      " ",
      "a".repeat(33),
      "Reddit",
      "red dit",
      "red_dit",
      "réd",
      "a\nb",
      "a/b",
      "<script>",
    ]) {
      expect(parseReferral(raw)).toBeNull()
    }
  })

  it("keeps a prototype key as an ordinary label", () => {
    expect(parseReferral("constructor")).toBe("constructor")
  })
})
