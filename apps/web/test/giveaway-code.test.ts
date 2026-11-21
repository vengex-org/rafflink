import { describe, expect, it } from "bun:test"
import { parseGiveawayCode } from "../src/lib/giveaway-code.ts"

describe("parseGiveawayCode", () => {
  it.each([
    ["YNX9N", "YNX9N"],
    ["  ynx9n ", "YNX9N"],
    ["https://rafflink.example/g/YNX9N", "YNX9N"],
    ["https://rafflink.example/g/ynx9n/verify?x=1", "YNX9N"],
    ["https://rafflink.example/YNX9N", "YNX9N"],
    ["rafflink.example/g/YNX9N", "YNX9N"],
  ])("finds the code in %s", (input, code) => {
    expect(parseGiveawayCode(input)).toBe(code)
  })

  it.each([
    "",
    "   ",
    "YNX9",
    "YNX9N7",
    "YNX0N",
    "hello world",
    "https://rafflink.example/",
    "https://rafflink.example/privacy",
    "/g/",
  ])("finds no code in %p", (input) => {
    expect(parseGiveawayCode(input)).toBeNull()
  })
})
