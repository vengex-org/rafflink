import { describe, expect, it } from "bun:test"
import { codeChallenge, codeVerifier } from "./pkce.ts"

describe("PKCE", () => {
  it("makes a 43-character base64url verifier from 32 random bytes", () => {
    const verifier = codeVerifier({ bytes: (length) => new Uint8Array(length).fill(0xfb) })

    expect(verifier).toHaveLength(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("derives the S256 challenge of RFC 7636 appendix B", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    )
  })
})
