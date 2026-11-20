import { describe, expect, it } from "bun:test"
import { systemClock, systemRandom } from "./system-ports.ts"

describe("system ports", () => {
  it("reads the current time", () => {
    const before = Date.now()
    const now = systemClock.now()

    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })

  it("returns exactly the requested number of bytes, different on each call", () => {
    const first = systemRandom.bytes(16)
    const second = systemRandom.bytes(16)

    expect(first).toHaveLength(16)
    expect(second).toHaveLength(16)
    expect(first).not.toEqual(second)
    expect(systemRandom.bytes(0)).toHaveLength(0)
  })
})
