import { describe, expect, it } from "bun:test"
import type { Random } from "../ports.ts"
import { toBase64 } from "./encoding.ts"
import { openKeyRing, openSecret, sealSecret, SealError, type SealReason } from "./seal.ts"

const random: Random = { bytes: (length) => crypto.getRandomValues(new Uint8Array(length)) }

function keyEntry(id: string, fill: number): string {
  return `${id}:${toBase64(new Uint8Array(32).fill(fill))}`
}

async function reason(promise: Promise<unknown>): Promise<SealReason> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SealError) return error.reason
    throw error
  }
  throw new Error("expected a SealError")
}

describe("seal", () => {
  it("opens with an older key of the ring", async () => {
    const oldRing = await openKeyRing([keyEntry("k1", 1)])
    const sealed = await sealSecret(oldRing, "refresh-token", "twitch:1", random)

    const rotated = await openKeyRing([keyEntry("k2", 2), keyEntry("k1", 1)])

    expect(await openSecret(rotated, sealed, "twitch:1")).toBe("refresh-token")
    expect(sealed.startsWith("k1.")).toBe(true)
  })

  it("seals new values with the first key of the ring", async () => {
    const ring = await openKeyRing([keyEntry("k2", 2), keyEntry("k1", 1)])

    const sealed = await sealSecret(ring, "value", "owner", random)

    expect(sealed.startsWith("k2.")).toBe(true)
  })

  it("seals the same value to different ciphertexts", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])

    const first = await sealSecret(ring, "value", "owner", random)
    const second = await sealSecret(ring, "value", "owner", random)

    expect(first).not.toBe(second)
  })

  it("keeps a plaintext with non-ASCII characters", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])

    const sealed = await sealSecret(ring, "žluťoučký kůň", "owner", random)

    expect(await openSecret(ring, sealed, "owner")).toBe("žluťoučký kůň")
  })

  it("refuses a value sealed for another owner", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])
    const sealed = await sealSecret(ring, "value", "twitch:1", random)

    expect(await reason(openSecret(ring, sealed, "twitch:2"))).toBe("cannot-open")
  })

  it("refuses a value whose key left the ring", async () => {
    const oldRing = await openKeyRing([keyEntry("k1", 1)])
    const sealed = await sealSecret(oldRing, "value", "owner", random)
    const newRing = await openKeyRing([keyEntry("k2", 2)])

    expect(await reason(openSecret(newRing, sealed, "owner"))).toBe("unknown-key")
  })

  it("refuses a key id that exists with different key bytes", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])
    const sealed = await sealSecret(ring, "value", "owner", random)
    const other = await openKeyRing([keyEntry("k1", 9)])

    expect(await reason(openSecret(other, sealed, "owner"))).toBe("cannot-open")
  })

  it("refuses a tampered ciphertext", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])
    const [keyId = "", iv = "", ciphertext = ""] = (
      await sealSecret(ring, "value", "owner", random)
    ).split(".")
    const flipped = ciphertext.startsWith("A")
      ? `B${ciphertext.slice(1)}`
      : `A${ciphertext.slice(1)}`

    expect(await reason(openSecret(ring, [keyId, iv, flipped].join("."), "owner"))).toBe(
      "cannot-open",
    )
  })

  it("refuses sealed text of the wrong shape", async () => {
    const ring = await openKeyRing([keyEntry("k1", 1)])

    for (const text of ["", "k1", "k1.AAAA", "k1.AAAA.AAAA.AAAA", "k1.!!!.AAAA", "k1.AAAA.AAAA"]) {
      expect(await reason(openSecret(ring, text, "owner"))).toBe("malformed-secret")
    }
  })
})

describe("openKeyRing", () => {
  const cases: readonly [string, readonly [string, ...string[]], SealReason][] = [
    ["an entry without a colon", ["k1"], "malformed-entry"],
    ["an empty key id", [`:${toBase64(new Uint8Array(32))}`], "bad-key-id"],
    ["a key id with a dot", [keyEntry("k.1", 1)], "bad-key-id"],
    ["a key id over 32 characters", [keyEntry("k".repeat(33), 1)], "bad-key-id"],
    ["a key that is not base64", ["k1:***"], "not-base64"],
    ["a key without padding", ["k1:AAAA"], "wrong-key-length"],
    ["a 31 byte key", [`k1:${toBase64(new Uint8Array(31))}`], "wrong-key-length"],
    ["a 33 byte key", [`k1:${toBase64(new Uint8Array(33))}`], "wrong-key-length"],
    ["a repeated key id", [keyEntry("k1", 1), keyEntry("k1", 2)], "duplicate-key-id"],
  ]

  for (const [name, entries, expected] of cases) {
    it(`rejects ${name}`, async () => {
      expect(await reason(openKeyRing(entries))).toBe(expected)
    })
  }

  it("never puts key material in the error", async () => {
    const entry = `k1:${toBase64(new Uint8Array(31).fill(65))}`

    try {
      await openKeyRing([entry])
    } catch (error) {
      expect(String(error)).not.toContain(entry.slice(3))
      return
    }
    throw new Error("expected a SealError")
  })
})
