import { describe, expect, it } from "bun:test"
import { usageAlerts, type Usage } from "./usage.ts"

const usage = (workers: number, durableObjects: number, limit: number | null = 100_000): Usage => ({
  workerRequests: { used: workers, limit },
  doRequests: { used: durableObjects, limit },
})

describe("usageAlerts", () => {
  it("stays quiet at 69 percent and alerts at exactly 70 percent", () => {
    expect(usageAlerts(usage(69_999, 0), 70)).toEqual([])
    expect(usageAlerts(usage(70_000, 0), 70)).toEqual([{ limit: "worker-requests", percent: 70 }])
  })

  it("names each limit that reached the percent, rounded down", () => {
    expect(usageAlerts(usage(75_500, 120_000), 70)).toEqual([
      { limit: "worker-requests", percent: 75 },
      { limit: "do-requests", percent: 120 },
    ])
    expect(usageAlerts(usage(0, 70_000), 70)).toEqual([{ limit: "do-requests", percent: 70 }])
  })

  it("never alerts on a limit the plan does not cap", () => {
    expect(usageAlerts(usage(5_000_000, 5_000_000, null), 70)).toEqual([])
  })

  it("follows the configured percent", () => {
    expect(usageAlerts(usage(49_999, 0), 50)).toEqual([])
    expect(usageAlerts(usage(50_000, 0), 50)).toEqual([{ limit: "worker-requests", percent: 50 }])
  })
})
