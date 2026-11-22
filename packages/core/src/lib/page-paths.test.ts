import { describe, expect, it } from "bun:test"
import { giveawayPath, verifyPath } from "./page-paths.ts"

describe("page paths", () => {
  it("writes the pages of a giveaway under its code", () => {
    expect(giveawayPath("ABCDE")).toBe("/ABCDE")
    expect(verifyPath("ABCDE")).toBe("/ABCDE/verify")
  })

  it("encodes a code that holds a reserved character", () => {
    expect(giveawayPath("A/B")).toBe("/A%2FB")
  })
})
