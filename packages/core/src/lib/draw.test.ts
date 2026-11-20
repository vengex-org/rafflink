import { createHmac } from "node:crypto"
import { describe, expect, it } from "bun:test"
import { drawWinners, indexFromDigest, pickWinner, type DrawEntry } from "./draw.ts"

const seed = new Uint8Array(32).fill(7)
const entries: DrawEntry[] = [
  { platform: "twitch", platformUserId: "3", tickets: 1 },
  { platform: "twitch", platformUserId: "1", tickets: 5 },
  { platform: "twitch", platformUserId: "2", tickets: 2 },
]

// Independent oracle for winner 0: first 64-bit word of HMAC-SHA256(seed, n as 8 bytes).
function firstWord(): bigint {
  return createHmac("sha256", seed).update(Buffer.alloc(8)).digest().readBigUInt64BE(0)
}

describe("drawWinners", () => {
  it("same seed and entries give the same winners", async () => {
    const first = await drawWinners(seed, entries, 2)
    const second = await drawWinners(seed, entries.toReversed(), 2)
    expect(first).toHaveLength(2)
    expect(second).toEqual(first)
  })

  it("picks the ticket the first HMAC word points at over entries sorted by id", async () => {
    // Sorted ids 1, 2, 3 own tickets [0,5), [5,7), [7,8).
    const index = Number(firstWord() % 8n)
    const expected = index < 5 ? "1" : index < 7 ? "2" : "3"
    const [winner] = await drawWinners(seed, entries, 1)
    expect(winner).toEqual({ n: 0, platform: "twitch", platformUserId: expected })
  })

  it("sorts by platform before platform user id", async () => {
    const mixed: DrawEntry[] = [
      { platform: "youtube", platformUserId: "1", tickets: 1 },
      { platform: "twitch", platformUserId: "9", tickets: 1 },
    ]
    const [winner] = await drawWinners(seed, mixed, 1)
    expect(winner?.platform).toBe(firstWord() % 2n === 0n ? "twitch" : "youtube")
  })

  it("never picks the same entrant twice", async () => {
    const winners = await drawWinners(seed, entries, 3)
    expect(winners.map((w) => w.platformUserId).toSorted()).toEqual(["1", "2", "3"])
    expect(winners.map((w) => w.n)).toEqual([0, 1, 2])
  })

  it("returns every entrant when count exceeds the entrants", async () => {
    expect(await drawWinners(seed, entries, 10)).toHaveLength(3)
  })

  it("returns nothing for zero entrants", async () => {
    expect(await drawWinners(seed, [], 3)).toEqual([])
  })

  it("returns nothing when every entrant has 0 tickets", async () => {
    const empty = entries.map((entry) => ({ ...entry, tickets: 0 }))
    expect(await drawWinners(seed, empty, 3)).toEqual([])
  })

  it("never picks an entrant with 0 tickets", async () => {
    const mixed: DrawEntry[] = [
      { platform: "twitch", platformUserId: "1", tickets: 0 },
      { platform: "twitch", platformUserId: "2", tickets: 1 },
    ]
    for (let i = 0; i < 20; i++) {
      const winners = await drawWinners(new Uint8Array(32).fill(i), mixed, 2)
      expect(winners.map((w) => w.platformUserId)).toEqual(["2"])
    }
  })

  it("returns nothing for count 0", async () => {
    expect(await drawWinners(seed, entries, 0)).toEqual([])
  })

  it("rejects a negative, fractional or non-finite count", async () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(drawWinners(seed, entries, count)).rejects.toThrow(RangeError)
    }
  })

  it("handles a ticket total beyond 2^53", async () => {
    const huge: DrawEntry[] = [
      { platform: "twitch", platformUserId: "1", tickets: Number.MAX_SAFE_INTEGER },
      { platform: "twitch", platformUserId: "2", tickets: Number.MAX_SAFE_INTEGER },
    ]
    expect(await drawWinners(seed, huge, 2)).toHaveLength(2)
  })
})

describe("pickWinner", () => {
  it("skips earlier winners including rerolled ones", async () => {
    const [first, second] = await drawWinners(seed, entries, 2)
    if (first === undefined || second === undefined) throw new Error("expected two winners")
    const next = await pickWinner(seed, 2, entries, [first, second])
    expect(next).not.toBeNull()
    expect(next?.platformUserId).not.toBe(first.platformUserId)
    expect(next?.platformUserId).not.toBe(second.platformUserId)
  })

  it("makes the same pick drawWinners makes for the same n and exclusions", async () => {
    const [first, second] = await drawWinners(seed, entries, 2)
    if (first === undefined) throw new Error("expected a winner")
    const again = await pickWinner(seed, 1, entries, [first])
    expect(again?.platformUserId).toBe(second?.platformUserId)
  })

  it("returns null once every entrant is excluded", async () => {
    expect(await pickWinner(seed, 3, entries, entries)).toBeNull()
  })
})

describe("indexFromDigest", () => {
  it("rejects a word in the biased tail and uses the next one", () => {
    // 2^64 mod 3 = 1, so only the word 2^64 - 1 is above the limit for total 3.
    const digest = new Uint8Array(16)
    digest.fill(0xff, 0, 8)
    new DataView(digest.buffer).setBigUint64(8, 7n)
    expect(indexFromDigest(digest, 3n)).toBe(1n)
  })

  it("returns null when every word is rejected", () => {
    expect(indexFromDigest(new Uint8Array(16).fill(0xff), 3n)).toBeNull()
  })

  it("returns the word modulo the total when it is below the limit", () => {
    const digest = new Uint8Array(8)
    new DataView(digest.buffer).setBigUint64(0, 10n)
    expect(indexFromDigest(digest, 4n)).toBe(2n)
  })
})
