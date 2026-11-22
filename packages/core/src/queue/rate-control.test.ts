import { describe, expect, it } from "bun:test"
import { decreasedRate, increasedRate, type RateConfig } from "./rate-control.ts"

const config: RateConfig = {
  queueMinRatePerSecond: 5,
  queueMaxRatePerSecond: 200,
  queueDecreasePercent: 67,
  queueIncreaseStepPerSecond: 10,
  queueIncreaseIntervalSeconds: 2,
}

describe("decreasedRate", () => {
  it("takes the configured percent of the rate that triggered the 429, rounded down", () => {
    expect(decreasedRate(config, 150)).toBe(100)
    expect(decreasedRate(config, 100)).toBe(67)
  })

  it("never goes below the floor, also for no measured rate at all", () => {
    expect(decreasedRate(config, 6)).toBe(5)
    expect(decreasedRate(config, 0)).toBe(5)
  })

  it("never goes above the ceiling", () => {
    expect(decreasedRate(config, 10_000)).toBe(200)
  })
})

describe("increasedRate", () => {
  it("keeps the rate until a whole interval has passed since it changed", () => {
    const rate = { perSecond: 60, changedAt: 10_000 }

    expect(increasedRate(config, rate, 11_999)).toEqual(rate)
  })

  it("adds one step per whole interval and moves the change time by those intervals only", () => {
    const rate = { perSecond: 60, changedAt: 10_000 }

    expect(increasedRate(config, rate, 12_000)).toEqual({ perSecond: 70, changedAt: 12_000 })
    expect(increasedRate(config, rate, 15_500)).toEqual({ perSecond: 80, changedAt: 14_000 })
  })

  it("stops at the ceiling", () => {
    expect(increasedRate(config, { perSecond: 195, changedAt: 0 }, 60_000)).toEqual({
      perSecond: 200,
      changedAt: 60_000,
    })
  })
})

describe("rate control over a burst", () => {
  it("drains at 2/3 of the trigger, grows additively and drops to 2/3 again at the next 429", () => {
    let rate = { perSecond: decreasedRate(config, 120), changedAt: 0 }
    expect(rate.perSecond).toBe(80)

    rate = increasedRate(config, rate, 6_000)
    expect(rate.perSecond).toBe(110)

    rate = { perSecond: decreasedRate(config, rate.perSecond), changedAt: 6_000 }
    expect(rate.perSecond).toBe(73)
  })
})
