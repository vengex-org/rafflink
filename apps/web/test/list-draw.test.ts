import { describe, expect, it } from "bun:test"
import { quicknet, roundTime } from "@rafflink/core/lib/drand"
import { fromHex } from "@rafflink/core/lib/encoding"
import {
  commitHash,
  commitLeadMs,
  commitList,
  drawNames,
  listFile,
  maxNames,
  parseListFile,
  parseNames,
  parseShareFragment,
  shareFragment,
  type ListCommit,
} from "../src/lib/list-draw.ts"

// The randomness of drand quicknet round 1,000,000 as api.drand.sh published it.
const seed = fromHex("b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3")
if (seed === null) throw new Error("seed is not hex")

const commit: ListCommit = {
  title: "Cup & mug",
  winners: 3,
  round: 1_000_000,
  committedAt: 1_700_000_000_000,
  names: ["Alice", "Bob", "Carol", "Dave", "Eve", "Zoë", "alice"],
}

function numberedNames(count: number): string {
  return Array.from({ length: count }, (_, i) => `n${i}`).join("\n")
}

describe("parseNames", () => {
  it("takes one trimmed name per line, drops blank lines and repeats, and sorts by code unit", () => {
    expect(parseNames("  Bob \r\n\nalice\nAlice\n\tBob\n \n")).toEqual({
      kind: "names",
      names: ["Alice", "Bob", "alice"],
      repeats: 1,
    })
  })

  it("counts a name typed in another Unicode form as a repeat", () => {
    const decomposed = "Zoe\u{308}"
    const composed = "Zo\u{eb}"

    expect(parseNames(`${decomposed}\n${composed}`)).toEqual({
      kind: "names",
      names: [composed],
      repeats: 1,
    })
  })

  it("rejects a list with no names", () => {
    expect(parseNames(" \n\n\t")).toEqual({ kind: "empty" })
  })

  it("takes the limit and rejects one name more", () => {
    expect(parseNames(numberedNames(maxNames)).kind).toBe("names")
    expect(parseNames(numberedNames(maxNames + 1))).toEqual({
      kind: "too-many",
      count: maxNames + 1,
    })
  })
})

describe("drawNames", () => {
  // Worked out with Python hmac: HMAC-SHA256(seed, n as 8 bytes) over the names in code-unit order.
  it("picks the winners the giveaway draw picks from the same seed and names", async () => {
    expect(await drawNames(seed, commit.names, 3)).toEqual(["Alice", "Dave", "alice"])
  })

  it("gives the same winners for the same names in any order", async () => {
    const shuffled = commit.names.toReversed()

    expect(await drawNames(seed, shuffled, 3)).toEqual(await drawNames(seed, commit.names, 3))
  })

  it("stops at the last name when more winners than names are asked for", async () => {
    expect(await drawNames(seed, ["Alice", "Bob"], 5)).toHaveLength(2)
  })
})

describe("commitList", () => {
  it("fixes the first round published at least the lead time after the commit", () => {
    const now = roundTime(quicknet, 2_000_000)

    const fixed = commitList(["Alice"], { title: "", winners: 1 }, now)

    expect(roundTime(quicknet, fixed.round)).toBeGreaterThanOrEqual(now + commitLeadMs)
    expect(roundTime(quicknet, fixed.round - 1)).toBeLessThan(now + commitLeadMs)
    expect(fixed.committedAt).toBe(now)
  })
})

describe("commitHash", () => {
  it("changes with every field the commit fixes", async () => {
    const hash = await commitHash(commit)
    const changed = [
      { ...commit, title: "Cup" },
      { ...commit, winners: 2 },
      { ...commit, round: 1_000_001 },
      { ...commit, committedAt: commit.committedAt - 1 },
      { ...commit, names: commit.names.slice(1) },
    ]

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await commitHash({ ...commit })).toBe(hash)
    for (const other of changed) expect(await commitHash(other)).not.toBe(hash)
  })
})

describe("share fragment", () => {
  it("carries a short list with its title, count, round, time and hash", async () => {
    const hash = await commitHash(commit)

    const { fragment, withNames } = shareFragment(commit, hash)
    const link = parseShareFragment(`#${fragment}`)

    expect(withNames).toBe(true)
    expect(link).toEqual({
      hash,
      commit: { title: "Cup & mug", winners: 3, round: 1_000_000, committedAt: 1_700_000_000_000 },
      names: commit.names,
    })
  })

  it("leaves out the names of a list too long for a link, and the title when there is none", async () => {
    const long = { ...commit, title: "", names: Array.from({ length: 400 }, (_, i) => `name${i}`) }

    const { fragment, withNames } = shareFragment(long, await commitHash(long))

    expect(withNames).toBe(false)
    expect(fragment.length).toBeLessThan(200)
    expect(parseShareFragment(fragment)).toMatchObject({ commit: { title: "" }, names: null })
  })

  it.each([
    ["another version", { v: "2" }],
    ["a short hash", { h: "ab" }],
    ["an upper-case hash", { h: "A".repeat(64) }],
    ["round 0", { r: "0" }],
    ["a negative round", { r: "-5" }],
    ["a fractional count", { w: "1.5" }],
    ["more winners than the name limit", { w: String(maxNames + 1) }],
    ["a time past the safe integers", { c: "9".repeat(20) }],
    ["a title over the limit", { t: "x".repeat(101) }],
    ["a name list of blank lines", { n: "\n \n" }],
  ])("rejects %s", async (_, change) => {
    const params = new URLSearchParams(shareFragment(commit, await commitHash(commit)).fragment)
    for (const [key, value] of Object.entries(change)) params.set(key, value)

    expect(parseShareFragment(params.toString())).toBeNull()
  })

  it.each(["h", "r", "w", "c"])("rejects a link without %s", async (key) => {
    const params = new URLSearchParams(shareFragment(commit, await commitHash(commit)).fragment)
    params.delete(key)

    expect(parseShareFragment(params.toString())).toBeNull()
  })
})

describe("list file", () => {
  it("reads back the commit it was written from", () => {
    expect(parseListFile(listFile(commit))).toEqual(commit)
  })

  it.each([
    ["text that is not JSON", "names"],
    ["a JSON array", "[]"],
    ["another version", listFile(commit).replace('"version": 1', '"version": 2')],
    ["a name that is not text", JSON.stringify({ ...JSON.parse(listFile(commit)), names: [1] })],
    ["no names", JSON.stringify({ ...JSON.parse(listFile(commit)), names: [] })],
    ["a fractional count", JSON.stringify({ ...JSON.parse(listFile(commit)), winners: 1.5 })],
  ])("rejects %s", (_, text) => {
    expect(parseListFile(text)).toBeNull()
  })
})
