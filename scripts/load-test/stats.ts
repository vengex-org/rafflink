export interface LatencySummary {
  readonly count: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

/** Nearest-rank percentiles in the unit of `valuesMs`; every field is 0 for an empty list. */
export function summarizeLatency(valuesMs: readonly number[]): LatencySummary {
  const sorted = valuesMs.toSorted((a, b) => a - b)
  return {
    count: sorted.length,
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    max: sorted.at(-1) ?? 0,
  }
}

function nearestRank(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0
}
