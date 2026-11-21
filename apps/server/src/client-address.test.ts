import { describe, expect, it } from "bun:test"
import { clientAddress } from "./client-address.ts"

const peer = { address: "198.51.100.9" }
const server = { requestIP: () => peer }
const unknownPeer = { requestIP: () => null }

function requestFrom(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers })
}

describe("clientAddress", () => {
  it("reads the address of the connection when no header is configured, whatever the client writes", () => {
    const request = requestFrom({ "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "1.1.1.1" })

    expect(clientAddress(request, server, null)).toBe("198.51.100.9")
  })

  it("returns null when no header is configured and the connection has no address", () => {
    expect(clientAddress(requestFrom({}), unknownPeer, null)).toBeNull()
  })

  it("reads the configured header and ignores the connection", () => {
    const request = requestFrom({ "cf-connecting-ip": " 203.0.113.7 " })

    expect(clientAddress(request, server, "cf-connecting-ip")).toBe("203.0.113.7")
  })

  it("returns null when the configured header is missing or blank, not the address of the proxy", () => {
    expect(clientAddress(requestFrom({}), server, "cf-connecting-ip")).toBeNull()
    expect(
      clientAddress(requestFrom({ "cf-connecting-ip": " " }), server, "cf-connecting-ip"),
    ).toBeNull()
  })

  it("takes the address the nearest proxy appended, not one the client wrote", () => {
    const request = requestFrom({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" })

    expect(clientAddress(request, server, "x-forwarded-for")).toBe("203.0.113.7")
  })
})
