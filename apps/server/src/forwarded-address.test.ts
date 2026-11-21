import { describe, expect, it } from "bun:test"
import { forwardedAddress } from "./forwarded-address.ts"

function requestFrom(forwardedFor: string | null): Request {
  return new Request("http://localhost/", {
    headers: forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor },
  })
}

describe("forwardedAddress", () => {
  it("returns null without the header and for a blank one", () => {
    expect(forwardedAddress(requestFrom(null))).toBeNull()
    expect(forwardedAddress(requestFrom(" "))).toBeNull()
  })

  it("returns the address the nearest proxy appended, not one the client wrote", () => {
    expect(forwardedAddress(requestFrom("198.51.100.1, 203.0.113.7"))).toBe("203.0.113.7")
  })
})
