import { describe, expect, it } from "bun:test"
import {
  limitsHeldAtFree,
  overriddenLimits,
  planLimits,
  type PlanLimitConfig,
} from "./plan-limits.ts"

const noOverrides: PlanLimitConfig = {
  workerRequestLimit: null,
  durableObjectRequestLimit: null,
  queueSubrequestsPerInvocation: null,
}

describe("planLimits", () => {
  it("caps Free at the daily limits and 45 subrequests per invocation", () => {
    expect(planLimits("free", noOverrides)).toEqual({
      workerRequestsPerDay: 100_000,
      doRequestsPerDay: 100_000,
      workerRequestsPerMonth: null,
      doRequestsPerMonth: null,
      subrequestsPerInvocation: 45,
    })
  })

  it("gives Paid no daily cap, the monthly allowances and 9000 subrequests per invocation", () => {
    expect(planLimits("paid", noOverrides)).toEqual({
      workerRequestsPerDay: null,
      doRequestsPerDay: null,
      workerRequestsPerMonth: 10_000_000,
      doRequestsPerMonth: 1_000_000,
      subrequestsPerInvocation: 9_000,
    })
  })

  it("puts each override set in the config in place of the plan's value, on either plan", () => {
    const overrides: PlanLimitConfig = {
      workerRequestLimit: 90_000,
      durableObjectRequestLimit: 80_000,
      queueSubrequestsPerInvocation: 16,
    }
    for (const plan of ["free", "paid"] as const) {
      expect(planLimits(plan, overrides)).toMatchObject({
        workerRequestsPerDay: 90_000,
        doRequestsPerDay: 80_000,
        subrequestsPerInvocation: 16,
      })
    }
    expect(planLimits("paid", { ...noOverrides, workerRequestLimit: 90_000 })).toMatchObject({
      workerRequestsPerDay: 90_000,
      doRequestsPerDay: null,
      subrequestsPerInvocation: 9_000,
    })
  })
})

describe("overriddenLimits", () => {
  it("flags only the limits the config sets", () => {
    expect(overriddenLimits(noOverrides)).toEqual({
      workerRequestsPerDay: false,
      doRequestsPerDay: false,
      subrequestsPerInvocation: false,
    })
    expect(overriddenLimits({ ...noOverrides, durableObjectRequestLimit: 0 })).toEqual({
      workerRequestsPerDay: false,
      doRequestsPerDay: true,
      subrequestsPerInvocation: false,
    })
  })
})

describe("limitsHeldAtFree", () => {
  const copiedFreeEnv: PlanLimitConfig = {
    workerRequestLimit: 100_000,
    durableObjectRequestLimit: 100_000,
    queueSubrequestsPerInvocation: 45,
  }

  it("names every override on Paid that sits at or below the Free value", () => {
    expect(limitsHeldAtFree("paid", copiedFreeEnv)).toEqual([
      "workerRequestsPerDay",
      "doRequestsPerDay",
      "subrequestsPerInvocation",
    ])
    expect(limitsHeldAtFree("paid", { ...noOverrides, queueSubrequestsPerInvocation: 10 })).toEqual(
      ["subrequestsPerInvocation"],
    )
  })

  it("names nothing on Free, without overrides, or for an override above the Free value", () => {
    expect(limitsHeldAtFree("free", copiedFreeEnv)).toEqual([])
    expect(limitsHeldAtFree("paid", noOverrides)).toEqual([])
    expect(limitsHeldAtFree("paid", { ...noOverrides, queueSubrequestsPerInvocation: 46 })).toEqual(
      [],
    )
  })
})
