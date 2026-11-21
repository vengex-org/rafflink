import { describe, expect, it } from "bun:test"
import { toHex } from "./encoding.ts"
import { emptyRoot, leafHash, merkleRoot } from "./merkle.ts"

// Expected values come from an independent implementation (Python hashlib) of the same definition.
const first = {
  platform: "twitch",
  platformUserId: "100",
  tickets: 3,
  salt: Uint8Array.from({ length: 16 }, (_, i) => i),
}
const firstHash = "b1806720b4ba44dec717ed035df2047d0e183f586a708afc990420d61a17a7a4"
const secondHash = "d5193ab98c3a16aa81722e34b5bcfe2016646b741dcdcbaac9e93c97d0b29668"
const thirdHash = "c926aa1ecaad6c82e89f5477e2efd6cd6df3c7cc830833c0a5c1d424e1b3d21c"

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

describe("leafHash", () => {
  it("is SHA-256 of platform, id, tickets and the salt, joined by |", async () => {
    expect(toHex(await leafHash(first))).toBe(firstHash)
  })

  it("changes with each part of the leaf", async () => {
    const hashes = await Promise.all([
      leafHash({ ...first, platform: "youtube" }),
      leafHash({ ...first, platformUserId: "101" }),
      leafHash({ ...first, tickets: 4 }),
      leafHash({ ...first, salt: new Uint8Array(16) }),
    ])

    expect(new Set([firstHash, ...hashes.map(toHex)]).size).toBe(5)
  })

  it("keeps an id with a | in it apart from a shifted ticket count", async () => {
    const piped = await leafHash({ ...first, platformUserId: "1|3", tickets: 5 })
    const shifted = await leafHash({ ...first, platformUserId: "1", tickets: 3 })

    expect(toHex(piped)).not.toBe(toHex(shifted))
  })
})

describe("merkleRoot", () => {
  it("is the hash of nothing for no leaves", async () => {
    expect(toHex(await merkleRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    expect(toHex(await emptyRoot())).toBe(toHex(await merkleRoot([])))
  })

  it("is the leaf itself for one leaf", async () => {
    expect(toHex(await merkleRoot([bytes(firstHash)]))).toBe(firstHash)
  })

  it("hashes a pair with the node prefix", async () => {
    expect(toHex(await merkleRoot([bytes(firstHash), bytes(secondHash)]))).toBe(
      "84043bf1a4ec0af3ab5245e576ad1037b0292cb014307b462ab57e8a31473980",
    )
  })

  it("carries an odd leaf up unchanged", async () => {
    expect(toHex(await merkleRoot([bytes(firstHash), bytes(secondHash), bytes(thirdHash)]))).toBe(
      "748eaa2f86ae60bed638fe3122c3ade71c1db683e955c871168ee7487846f90c",
    )
  })

  it("depends on the order of the leaves", async () => {
    const forward = await merkleRoot([bytes(firstHash), bytes(secondHash)])
    const backward = await merkleRoot([bytes(secondHash), bytes(firstHash)])

    expect(toHex(forward)).not.toBe(toHex(backward))
  })
})
