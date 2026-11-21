import { describe } from "bun:test"
import { chatClaimScenarios } from "./chat-claim.scenarios.ts"
import { commitmentScenarios } from "./commitment.scenarios.ts"
import { entryScenarios } from "./entry.scenarios.ts"
import { giveawayScenarios } from "./giveaway.scenarios.ts"
import { liveScenarios } from "./live.scenarios.ts"
import { operationsScenarios } from "./operations.scenarios.ts"
import { pageScenarios } from "./page.scenarios.ts"
import { queueScenarios } from "./queue.scenarios.ts"
import { retentionScenarios } from "./retention.scenarios.ts"
import { viewerPushScenarios } from "./viewer-push.scenarios.ts"
import type { PageServing, StartTarget } from "./target.ts"

/**
 * Registers the black-box scenarios of spec AC-6 to AC-22 against one deployment target. The suite
 * runs its own fake Twitch and reaches the target only through the members of `ContractTarget`.
 */
export function defineContract(
  targetName: string,
  pages: PageServing,
  startTarget: StartTarget,
): void {
  const context = { targetName, pages, startTarget }
  describe("contract", () => {
    entryScenarios(context)
    queueScenarios(context)
    giveawayScenarios(context)
    commitmentScenarios(context)
    liveScenarios(context)
    viewerPushScenarios(context)
    chatClaimScenarios(context)
    operationsScenarios(context)
    retentionScenarios(context)
    pageScenarios(context)
  })
}
