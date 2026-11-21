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
  const leafA = { hash: bytes(firstHash), tickets: 3 }
  const leafB = { hash: bytes(secondHash), tickets: 1 }
  const leafC = { hash: bytes(thirdHash), tickets: 7 }

  it("is the hash of nothing for no leaves", async () => {
    expect(toHex(await merkleRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    expect(toHex(await emptyRoot())).toBe(toHex(await merkleRoot([])))
  })

  it("is the leaf node of hash and tickets for one leaf", async () => {
    expect(toHex(await merkleRoot([leafA]))).toBe(
      "66d8d7cb618dd26ae7d68ba437c744fcf17aacec11ff62adc47dc6152e807156",
    )
  })

  it("hashes a pair of leaf nodes with the node prefix", async () => {
    expect(toHex(await merkleRoot([leafA, leafB]))).toBe(
      "ae386ef8c38507ce8665bc5fc80b35d6d856ccca988dab6b143c8feb932fe427",
    )
  })

  it("carries an odd leaf node up unchanged", async () => {
    expect(toHex(await merkleRoot([leafA, leafB, leafC]))).toBe(
      "18be196b36601399c0b0bfe7ce7b4738634d2bc11a25da1f4b0610218cc3b0de",
    )
  })

  it("depends on the order of the leaves", async () => {
    const forward = await merkleRoot([leafA, leafB])
    const backward = await merkleRoot([leafB, leafA])

    expect(toHex(forward)).not.toBe(toHex(backward))
  })

  it("binds the tickets: moving tickets between leaves changes the root", async () => {
    const shifted = await merkleRoot([{ ...leafA, tickets: 4 }, { ...leafB, tickets: 0 }, leafC])

    expect(toHex(shifted)).toBe("4ea587ea7f39e4adec5b4bdb39a874fae8d0813b34c1ce91bfd521640679abd6")
    expect(toHex(shifted)).not.toBe(toHex(await merkleRoot([leafA, leafB, leafC])))
  })
})
