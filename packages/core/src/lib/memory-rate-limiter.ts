import type { Clock, Instant, RateLimiter } from "../ports.ts"

/** A {@link RateLimiter} in the memory of one process: each key has a fixed window that starts at its first call. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { readonly startedAt: Instant; calls: number }>()
  private nextSweepAt: Instant = 0

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async allow(key: string): Promise<boolean> {
    const now = this.clock.now()
    this.sweep(now)
    const current = this.windows.get(key)
    if (current === undefined || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, calls: 1 })
      return true
    }
    current.calls += 1
    return current.calls <= this.limit
  }

  // Keys that never come back would stay forever, so each window length drops the expired ones.
  private sweep(now: Instant): void {
    if (now < this.nextSweepAt) return
    this.nextSweepAt = now + this.windowMs
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key)
    }
  }
}
