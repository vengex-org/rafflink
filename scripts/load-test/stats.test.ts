import { describe, expect, it } from "bun:test"
import { summarizeLatency } from "./stats.ts"

describe("summarizeLatency", () => {
  it("takes nearest-rank percentiles of an unsorted list", () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index)

    expect(summarizeLatency(values)).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 })
  })

  it("returns the only value for every percentile of a single value", () => {
    expect(summarizeLatency([7])).toEqual({ count: 1, p50: 7, p95: 7, p99: 7, max: 7 })
  })

  it("rounds the rank up so p99 of 10 values is the largest", () => {
    expect(summarizeLatency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).p99).toBe(10)
  })

  it("returns zeros for an empty list", () => {
    expect(summarizeLatency([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 })
  })

  it("leaves the input list as it was", () => {
    const values = [3, 1, 2]

    summarizeLatency(values)

    expect(values).toEqual([3, 1, 2])
  })
})
