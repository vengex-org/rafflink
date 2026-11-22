import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { CloudflarePlan } from "./plan-limits.ts"

/** The token queue a plan switch reaches at once, so its next alarm invocation already takes the new budget. */
export interface PlanQueue {
  usePlan(plan: CloudflarePlan): Promise<void>
}

/** The plan an admin switched to, else `CLOUDFLARE_PLAN`. */
export async function currentPlan(
  accounts: Pick<AccountStore, "storedCloudflarePlan">,
  config: Pick<ResolvedConfig, "cloudflarePlan">,
): Promise<CloudflarePlan> {
  return (await accounts.storedCloudflarePlan()) ?? config.cloudflarePlan
}
