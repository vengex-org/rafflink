import { describe, expect, it } from "bun:test"
import { safeReturnPath } from "./return-path.ts"

describe("safeReturnPath", () => {
  it.each(["/dashboard", "/live/abc123", "/dashboard/new?step=2", "/live/abc?q=a%2Fb"])(
    "keeps the path %s on this site",
    (path) => {
      expect(safeReturnPath(path)).toBe(path)
    },
  )

  it.each([
    ["nothing", undefined],
    ["an empty value", ""],
    ["a path without the leading slash", "dashboard"],
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a backslash", "/\\evil.example"],
    ["a backslash anywhere", "/live\\x"],
    ["a full URL", "https://evil.example"],
    ["a scheme", "javascript:alert(1)"],
    ["a tab that a parser drops", "/\t/evil.example"],
    ["a newline", "/live\n/x"],
    ["a null character", "/live\u0000"],
    ["a delete character", "/live\u007f"],
    ["a path longer than a cookie should carry", `/${"a".repeat(200)}`],
  ])("refuses %s", (_, path) => {
    expect(safeReturnPath(path)).toBeNull()
  })

  it("keeps a path of exactly the longest accepted length", () => {
    const path = `/${"a".repeat(199)}`

    expect(safeReturnPath(path)).toBe(path)
  })
})
