import type { ResolvedConfig } from "../config.ts"

/** The Cloudflare Workers plans the hosted service can run on. */
export const cloudflarePlans = ["free", "paid"] as const
export type CloudflarePlan = (typeof cloudflarePlans)[number]

/** What one plan allows, as the usage meter and the token queue apply it. */
export interface PlanLimits {
  /** Null: the plan has no daily cap, requests beyond the monthly allowance are billed. */
  readonly workerRequestsPerDay: number | null
  readonly doRequestsPerDay: number | null
  /** Requests the monthly price includes; null on Free, which bills nothing. */
  readonly workerRequestsPerMonth: number | null
  readonly doRequestsPerMonth: number | null
  /** External subrequests one queue alarm invocation may send, below the plan's limit for headroom. */
  readonly subrequestsPerInvocation: number
}

export type PlanLimitConfig = Pick<
  ResolvedConfig,
  "workerRequestLimit" | "durableObjectRequestLimit" | "queueSubrequestsPerInvocation"
>

// Cloudflare docs, read 2026-11-22: developers.cloudflare.com/workers/platform/limits/ (Free 100,000
// requests a day and 50 subrequests per invocation, Paid no daily limit and 10,000 subrequests by default),
// developers.cloudflare.com/workers/platform/pricing/ (Paid includes 10 million requests a month) and
// developers.cloudflare.com/durable-objects/platform/pricing/ (Free 100,000 a day, Paid includes 1 million
// a month). The subrequest budgets leave 10% headroom for the room writes and retries of a pass.
const planDefaults: Readonly<Record<CloudflarePlan, PlanLimits>> = {
  free: {
    workerRequestsPerDay: 100_000,
    doRequestsPerDay: 100_000,
    workerRequestsPerMonth: null,
    doRequestsPerMonth: null,
    subrequestsPerInvocation: 45,
  },
  paid: {
    workerRequestsPerDay: null,
    doRequestsPerDay: null,
    workerRequestsPerMonth: 10_000_000,
    doRequestsPerMonth: 1_000_000,
    subrequestsPerInvocation: 9_000,
  },
}

/** Which limits the config sets, so they apply on every plan instead of the plan's own value. */
export interface PlanLimitOverrides {
  readonly workerRequestsPerDay: boolean
  readonly doRequestsPerDay: boolean
  readonly subrequestsPerInvocation: boolean
}

/** The plan's limits, with each limit the config sets explicitly in place of the plan's value. */
export function planLimits(plan: CloudflarePlan, config: PlanLimitConfig): PlanLimits {
  const limits = planDefaults[plan]
  return {
    ...limits,
    workerRequestsPerDay: config.workerRequestLimit ?? limits.workerRequestsPerDay,
    doRequestsPerDay: config.durableObjectRequestLimit ?? limits.doRequestsPerDay,
    subrequestsPerInvocation:
      config.queueSubrequestsPerInvocation ?? limits.subrequestsPerInvocation,
  }
}

export function overriddenLimits(config: PlanLimitConfig): PlanLimitOverrides {
  return {
    workerRequestsPerDay: config.workerRequestLimit !== null,
    doRequestsPerDay: config.durableObjectRequestLimit !== null,
    subrequestsPerInvocation: config.queueSubrequestsPerInvocation !== null,
  }
}

/** The limits a config override holds on Paid at or below Free's value, as an old Free `.env` leaves them. */
export function limitsHeldAtFree(
  plan: CloudflarePlan,
  config: PlanLimitConfig,
): (keyof PlanLimitOverrides)[] {
  if (plan !== "paid") return []
  const free = planDefaults.free
  const overrides: readonly (readonly [keyof PlanLimitOverrides, number | null])[] = [
    ["workerRequestsPerDay", config.workerRequestLimit],
    ["doRequestsPerDay", config.durableObjectRequestLimit],
    ["subrequestsPerInvocation", config.queueSubrequestsPerInvocation],
  ]
  return overrides.flatMap(([limit, value]) => {
    const freeValue = free[limit]
    return value !== null && freeValue !== null && value <= freeValue ? [limit] : []
  })
}
