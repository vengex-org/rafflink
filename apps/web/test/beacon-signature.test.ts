import { describe, expect, it } from "bun:test"
import { quicknet } from "@rafflink/core/lib/drand"
import { fromHex } from "@rafflink/core/lib/encoding"
import type { BeaconRound } from "@rafflink/core/ports"
import { verifyBeaconSignature } from "../src/lib/beacon-signature.ts"

// Round 1,000,000 of quicknet as api.drand.sh published it.
const signature =
  "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72"
const randomness = fromHex("b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3")
const real: BeaconRound = {
  round: 1_000_000,
  randomness: randomness ?? new Uint8Array(0),
  signature,
}

describe("verifyBeaconSignature", () => {
  it("accepts the signature drand published for a round", async () => {
    expect(await verifyBeaconSignature(quicknet.chainHash, real)).toBe(true)
  })

  it("rejects the same signature for another round", async () => {
    expect(await verifyBeaconSignature(quicknet.chainHash, { ...real, round: 1_000_001 })).toBe(
      false,
    )
  })

  it("rejects a signature with one bit flipped, and bytes that are no curve point", async () => {
    const flipped = `${signature.slice(0, -1)}3`
    const noPoint = "ff".repeat(48)

    expect(await verifyBeaconSignature(quicknet.chainHash, { ...real, signature: flipped })).toBe(
      false,
    )
    expect(await verifyBeaconSignature(quicknet.chainHash, { ...real, signature: noPoint })).toBe(
      false,
    )
  })

  it("rejects a signature of the wrong length and one that is not hex", async () => {
    for (const bad of ["", "00", "zz", signature.slice(2)]) {
      expect(await verifyBeaconSignature(quicknet.chainHash, { ...real, signature: bad })).toBe(
        false,
      )
    }
  })

  it("rejects a round claimed for a chain whose key is not pinned", async () => {
    expect(await verifyBeaconSignature("00".repeat(32), real)).toBe(false)
  })
})
