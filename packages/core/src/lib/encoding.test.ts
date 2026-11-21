import { describe, expect, it } from "bun:test"
import { fromHex, toHex } from "./encoding.ts"

describe("fromHex", () => {
  it("reads what toHex writes", () => {
    const bytes = Uint8Array.of(0, 1, 15, 16, 255)

    expect(fromHex(toHex(bytes))).toEqual(bytes)
    expect(fromHex("")).toEqual(new Uint8Array(0))
  })

  it("refuses odd length, upper case and other characters", () => {
    for (const text of ["abc", "AB", "zz", "0x00", " 00", "0g"]) expect(fromHex(text)).toBeNull()
  })
})
