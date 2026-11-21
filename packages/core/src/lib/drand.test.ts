import { describe, expect, it } from "bun:test"
import { parseBeaconRound, quicknet, roundAtOrAfter, roundPath, roundTime } from "./drand.ts"
import { toHex } from "./encoding.ts"

// Round 1,000,000 of quicknet as api.drand.sh published it.
const published = {
  round: 1_000_000,
  randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
  signature:
    "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
}

const genesisMs = quicknet.genesisSeconds * 1000

describe("roundAtOrAfter", () => {
  it("is round 1 at genesis and before it", () => {
    expect(roundAtOrAfter(quicknet, genesisMs)).toBe(1)
    expect(roundAtOrAfter(quicknet, 0)).toBe(1)
  })

  it("is the first round published at or after the instant", () => {
    expect(roundAtOrAfter(quicknet, genesisMs + 1)).toBe(2)
    expect(roundAtOrAfter(quicknet, genesisMs + 3000)).toBe(2)
    expect(roundAtOrAfter(quicknet, genesisMs + 3001)).toBe(3)
  })

  it("is at least the lead away from now when the lead is added to now", () => {
    const now = genesisMs + 123_456
    const round = roundAtOrAfter(quicknet, now + 30_000)

    expect(roundTime(quicknet, round)).toBeGreaterThanOrEqual(now + 30_000)
    expect(roundTime(quicknet, round - 1)).toBeLessThan(now + 30_000)
  })
})

describe("roundTime", () => {
  it("counts rounds from genesis", () => {
    expect(roundTime(quicknet, 1)).toBe(genesisMs)
    expect(roundTime(quicknet, 11)).toBe(genesisMs + 30_000)
  })
})

describe("roundPath", () => {
  it("names the chain and the round", () => {
    expect(roundPath(quicknet.chainHash, 42)).toBe(`/${quicknet.chainHash}/public/42`)
  })
})

describe("parseBeaconRound", () => {
  it("reads a round drand published", async () => {
    const round = await parseBeaconRound(published, 1_000_000)

    expect(round?.round).toBe(1_000_000)
    expect(round === null ? "" : toHex(round.randomness)).toBe(published.randomness)
    expect(round?.signature).toBe(published.signature)
  })

  it("refuses an answer for another round", async () => {
    expect(await parseBeaconRound(published, 1_000_001)).toBeNull()
  })

  it("refuses randomness that is not the hash of the signature", async () => {
    const forged = { ...published, randomness: "00".repeat(32) }

    expect(await parseBeaconRound(forged, 1_000_000)).toBeNull()
  })

  it("refuses anything that is not a round answer", async () => {
    const bad: unknown[] = [
      null,
      "round",
      [],
      {},
      { ...published, signature: "" },
      { ...published, signature: "xyz" },
      { ...published, randomness: published.randomness.toUpperCase() },
      { ...published, randomness: published.randomness.slice(2) },
      { ...published, round: "1000000" },
      { ...published, randomness: 7 },
    ]

    for (const body of bad) expect(await parseBeaconRound(body, 1_000_000)).toBeNull()
  })
})
