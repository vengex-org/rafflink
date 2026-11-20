import { describe } from "bun:test"
import { entryScenarios } from "./entry.scenarios.ts"
import { giveawayScenarios } from "./giveaway.scenarios.ts"
import { liveScenarios } from "./live.scenarios.ts"
import { operationsScenarios } from "./operations.scenarios.ts"
import { queueScenarios } from "./queue.scenarios.ts"
import type { StartTarget } from "./target.ts"

/**
 * Registers the black-box scenarios of spec AC-6 to AC-22 against one deployment target. The suite
 * runs its own fake Twitch and reaches the target only through the members of `ContractTarget`.
 */
export function defineContract(targetName: string, startTarget: StartTarget): void {
  const context = { targetName, startTarget }
  describe("contract", () => {
    entryScenarios(context)
    queueScenarios(context)
    giveawayScenarios(context)
    liveScenarios(context)
    operationsScenarios(context)
  })
}
