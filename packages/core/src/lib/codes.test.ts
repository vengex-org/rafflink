import { describe, expect, it } from "bun:test"
import type { Random } from "../ports.ts"
import { codeAlphabet, codeLength, generateCode } from "./codes.ts"

describe("generateCode", () => {
  it("never contains look-alike characters", () => {
    const codes = allByteCodes()
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      expect(code).not.toMatch(/[0O1lI]/)
    }
  })

  it("is codeLength characters from the alphabet", () => {
    for (const code of allByteCodes()) {
      expect(code).toHaveLength(codeLength)
      for (const char of code) expect(codeAlphabet).toContain(char)
    }
  })

  it("can produce every alphabet character", () => {
    const seen = new Set(allByteCodes().join(""))
    expect([...seen].toSorted()).toEqual([...codeAlphabet].toSorted())
  })

  it("maps equal random bytes to equal codes", () => {
    const random: Random = { bytes: (length) => new Uint8Array(length).fill(9) }
    expect(generateCode(random)).toBe(generateCode(random))
  })
})

describe("codeAlphabet", () => {
  it("has distinct characters and a size that divides 256, so a byte maps without bias", () => {
    expect(new Set(codeAlphabet).size).toBe(codeAlphabet.length)
    expect(256 % codeAlphabet.length).toBe(0)
  })
})

/** One code per run of `codeLength` bytes, covering every byte value 0-255. */
function allByteCodes(): string[] {
  const codes: string[] = []
  for (let first = 0; first < 256; first += codeLength) {
    const random: Random = {
      bytes: (length) => Uint8Array.from({ length }, (_, i) => (first + i) % 256),
    }
    codes.push(generateCode(random))
  }
  return codes
}
