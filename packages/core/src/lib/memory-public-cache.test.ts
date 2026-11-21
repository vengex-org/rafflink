import { describe, expect, it } from "bun:test"
import { TestClock } from "../../test/app-fixture.ts"
import { MemoryPublicCache } from "./memory-public-cache.ts"

describe("MemoryPublicCache", () => {
  it("returns a written text until its time to live has passed", async () => {
    const clock = new TestClock(1_000)
    const cache = new MemoryPublicCache(clock, 10)
    await cache.write("a", "text", 5)

    clock.advance(4_999)
    expect(await cache.read("a")).toBe("text")

    clock.advance(1)
    expect(await cache.read("a")).toBeNull()
  })

  it("returns null for a key never written and keeps keys apart", async () => {
    const cache = new MemoryPublicCache(new TestClock(0), 10)
    await cache.write("a", "first", 5)

    expect(await cache.read("b")).toBeNull()
    expect(await cache.read("a")).toBe("first")
  })

  it("replaces an entry with a later write and restarts its time to live", async () => {
    const clock = new TestClock(0)
    const cache = new MemoryPublicCache(clock, 10)
    await cache.write("a", "old", 5)
    clock.advance(4_000)
    await cache.write("a", "new", 5)

    clock.advance(4_000)

    expect(await cache.read("a")).toBe("new")
  })

  it("drops the oldest write when more entries than the maximum are held", async () => {
    const cache = new MemoryPublicCache(new TestClock(0), 2)
    await cache.write("a", "1", 5)
    await cache.write("b", "2", 5)
    await cache.write("a", "1 again", 5)

    await cache.write("c", "3", 5)

    expect(await cache.read("b")).toBeNull()
    expect(await cache.read("a")).toBe("1 again")
    expect(await cache.read("c")).toBe("3")
  })
})
