import type { DayRequests } from "../ports.ts"
import type { PlanLimits } from "./plan-limits.ts"

/** Requests used today against a daily limit; `limit` is null when the plan has no daily cap. */
export interface Quota {
  readonly used: number
  readonly limit: number | null
}

/** The current UTC day's use of the target's daily limits. */
export interface Usage {
  readonly workerRequests: Quota
  readonly doRequests: Quota
}

export const usageAlertLimits = ["worker-requests", "do-requests"] as const
export type UsageAlertLimit = (typeof usageAlertLimits)[number]

/** A daily limit today's requests have reached `percent` of, rounded down. */
export interface UsageAlert {
  readonly limit: UsageAlertLimit
  readonly percent: number
}

export function usageOf(requests: DayRequests, limits: PlanLimits): Usage {
  return {
    workerRequests: { used: requests.workerRequests, limit: limits.workerRequestsPerDay },
    doRequests: { used: requests.doRequests, limit: limits.doRequestsPerDay },
  }
}

/** The daily limits at or above `alertPercent`; a limit the plan does not cap never alerts. */
export function usageAlerts(usage: Usage, alertPercent: number): UsageAlert[] {
  const quotas: readonly [UsageAlertLimit, Quota][] = [
    ["worker-requests", usage.workerRequests],
    ["do-requests", usage.doRequests],
  ]
  return quotas.flatMap(([limit, { used, limit: cap }]) =>
    // Whole numbers on both sides, so 69,999 of 100,000 stays below 70 percent.
    cap !== null && used * 100 >= alertPercent * cap
      ? [{ limit, percent: Math.floor((used * 100) / cap) }]
      : [],
  )
}
