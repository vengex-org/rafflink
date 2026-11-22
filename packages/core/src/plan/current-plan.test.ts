import { describe, expect, it } from "bun:test"
import { currentPlanOrFree } from "./current-plan.ts"
import type { CloudflarePlan } from "./plan-limits.ts"

const paidEnv = { cloudflarePlan: "paid" } as const

function accountsReading(stored: () => Promise<CloudflarePlan | null>) {
  return { storedCloudflarePlan: stored }
}

function never(): void {
  throw new Error("the read did not fail")
}

describe("currentPlanOrFree", () => {
  it("answers the stored plan, else the configured one", async () => {
    expect(
      await currentPlanOrFree(
        accountsReading(async () => "free"),
        paidEnv,
        never,
      ),
    ).toBe("free")
    expect(
      await currentPlanOrFree(
        accountsReading(async () => null),
        paidEnv,
        never,
      ),
    ).toBe("paid")
  })

  it("answers Free, not the configured plan, and reports the error when the read fails", async () => {
    const failure = new Error("D1 unreachable")
    const reported: unknown[] = []

    const plan = await currentPlanOrFree(
      accountsReading(async () => {
        throw failure
      }),
      paidEnv,
      (error) => reported.push(error),
    )

    expect(plan).toBe("free")
    expect(reported).toEqual([failure])
  })
})
