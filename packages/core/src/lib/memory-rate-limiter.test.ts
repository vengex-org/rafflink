import { describe, expect, it } from "bun:test"
import { TestClock } from "../../test/app-fixture.ts"
import { MemoryRateLimiter } from "./memory-rate-limiter.ts"

describe("MemoryRateLimiter", () => {
  it("allows the limit within a window and refuses the next call", async () => {
    const limiter = new MemoryRateLimiter(new TestClock(0), 2, 60_000)

    expect([await limiter.allow("a"), await limiter.allow("a"), await limiter.allow("a")]).toEqual([
      true,
      true,
      false,
    ])
  })

  it("keeps keys apart", async () => {
    const limiter = new MemoryRateLimiter(new TestClock(0), 1, 60_000)
    await limiter.allow("a")

    expect(await limiter.allow("a")).toBe(false)
    expect(await limiter.allow("b")).toBe(true)
  })

  it("allows again once the window of the key has passed", async () => {
    const clock = new TestClock(0)
    const limiter = new MemoryRateLimiter(clock, 1, 60_000)
    await limiter.allow("a")

    clock.advance(59_999)
    expect(await limiter.allow("a")).toBe(false)

    clock.advance(1)
    expect(await limiter.allow("a")).toBe(true)
  })

  it("does not count refused calls into the next window", async () => {
    const clock = new TestClock(0)
    const limiter = new MemoryRateLimiter(clock, 1, 60_000)
    for (let call = 0; call < 5; call++) await limiter.allow("a")

    clock.advance(60_000)

    expect(await limiter.allow("a")).toBe(true)
    expect(await limiter.allow("a")).toBe(false)
  })
})
