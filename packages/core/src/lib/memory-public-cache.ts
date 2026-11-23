import type { Clock, Instant, PublicCache } from "../ports.ts"

/**
 * A {@link PublicCache} in the memory of one process; an entry is dropped when it is read or another write finds
 * it expired, and the oldest write goes when more than `maxEntries` are held.
 */
export class MemoryPublicCache implements PublicCache {
  private readonly entries = new Map<
    string,
    { readonly text: string; readonly expiresAt: Instant }
  >()

  constructor(
    private readonly clock: Clock,
    private readonly maxEntries: number,
  ) {}

  async read(key: string): Promise<string | null> {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (this.clock.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return null
    }
    return entry.text
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async write(key: string, text: string, ttlSeconds: number): Promise<void> {
    const now = this.clock.now()
    for (const [name, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(name)
    }
    // A rewritten key moves to the back of the Map's order, so the first key is always the oldest write.
    this.entries.delete(key)
    this.entries.set(key, { text, expiresAt: now + ttlSeconds * 1000 })
    for (const name of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(name)
    }
  }
}
