import { describe } from "bun:test"
import { chatClaimScenarios } from "./chat-claim.scenarios.ts"
import { channelEntryScenarios } from "./channel-entry.scenarios.ts"
import { chatEntryScenarios } from "./chat-entry.scenarios.ts"
import { commitmentScenarios } from "./commitment.scenarios.ts"
import { entryScenarios } from "./entry.scenarios.ts"
import { giveawayScenarios } from "./giveaway.scenarios.ts"
import { kickScenarios } from "./kick.scenarios.ts"
import { liveScenarios } from "./live.scenarios.ts"
import { operationsScenarios } from "./operations.scenarios.ts"
import { pageScenarios } from "./page.scenarios.ts"
import { queueScenarios } from "./queue.scenarios.ts"
import { retentionScenarios } from "./retention.scenarios.ts"
import { sessionScenarios } from "./session.scenarios.ts"
import { viewerPushScenarios } from "./viewer-push.scenarios.ts"
import { youtubeScenarios } from "./youtube.scenarios.ts"
import type { PageServing, PlanSwitching, StartTarget } from "./target.ts"

/**
 * Registers the black-box scenarios of spec AC-6 to AC-22 against one deployment target. The suite
 * runs its own fake Twitch and reaches the target only through the members of `ContractTarget`.
 */
export function defineContract(
  targetName: string,
  pages: PageServing,
  plans: PlanSwitching,
  startTarget: StartTarget,
): void {
  const context = { targetName, pages, plans, startTarget }
  describe("contract", () => {
    entryScenarios(context)
    queueScenarios(context)
    giveawayScenarios(context)
    commitmentScenarios(context)
    liveScenarios(context)
    viewerPushScenarios(context)
    chatClaimScenarios(context)
    chatEntryScenarios(context)
    channelEntryScenarios(context)
    kickScenarios(context)
    youtubeScenarios(context)
    operationsScenarios(context)
    retentionScenarios(context)
    pageScenarios(context)
    sessionScenarios(context)
  })
}
