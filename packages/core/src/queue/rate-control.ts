import type { ResolvedConfig } from "../config.ts"
import type { Instant } from "../ports.ts"

export type RateConfig = Pick<
  ResolvedConfig,
  | "queueMinRatePerSecond"
  | "queueMaxRatePerSecond"
  | "queueDecreasePercent"
  | "queueIncreaseStepPerSecond"
  | "queueIncreaseIntervalSeconds"
>

/** The token queue's drain rate in calls per second, and the instant the next additive step counts from. */
export interface DrainRate {
  readonly perSecond: number
  readonly changedAt: Instant
}

/** The multiplicative decrease after a 429: a share of the calls per second that triggered it, inside the floor and the ceiling. */
export function decreasedRate(config: RateConfig, triggerPerSecond: number): number {
  return withinRails(config, Math.floor((triggerPerSecond * config.queueDecreasePercent) / 100))
}

/** The additive increase: one step per whole interval since the rate last changed, up to the ceiling. */
export function increasedRate(config: RateConfig, rate: DrainRate, now: Instant): DrainRate {
  const intervalMs = config.queueIncreaseIntervalSeconds * 1000
  const steps = Math.floor((now - rate.changedAt) / intervalMs)
  if (steps <= 0) return rate
  return {
    perSecond: withinRails(config, rate.perSecond + steps * config.queueIncreaseStepPerSecond),
    changedAt: rate.changedAt + steps * intervalMs,
  }
}

function withinRails(config: RateConfig, perSecond: number): number {
  return Math.min(config.queueMaxRatePerSecond, Math.max(config.queueMinRatePerSecond, perSecond))
}
