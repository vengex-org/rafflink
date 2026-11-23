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
import { presenceScenarios } from "./presence.scenarios.ts"
import { queueScenarios } from "./queue.scenarios.ts"
import { retentionScenarios } from "./retention.scenarios.ts"
import { sessionScenarios } from "./session.scenarios.ts"
import { viewerPushScenarios } from "./viewer-push.scenarios.ts"
import { youtubeScenarios } from "./youtube.scenarios.ts"
import type { ContractContext, PageServing, PlanSwitching, StartTarget } from "./target.ts"

/**
 * The scenarios split into parts of about equal run time, one test file per part and target, so `bun test --parallel`
 * runs them in separate processes. Inside a part the scenarios stay serial: their timing windows (a cache time, a push
 * interval) do not hold when many targets share one event loop.
 */
export const contractParts: readonly (readonly ((context: ContractContext) => void)[])[] = [
  [giveawayScenarios, presenceScenarios],
  [kickScenarios, entryScenarios],
  [liveScenarios, pageScenarios, channelEntryScenarios],
  [chatClaimScenarios, viewerPushScenarios],
  [retentionScenarios, queueScenarios],
  [
    youtubeScenarios,
    operationsScenarios,
    sessionScenarios,
    chatEntryScenarios,
    commitmentScenarios,
  ],
]

/**
 * Registers the black-box scenarios of spec AC-6 to AC-22 in part `part` (counted from 1, like the test file names)
 * against one deployment target. The suite runs its own fake Twitch and reaches the target only through the members of
 * `ContractTarget`.
 */
export function defineContract(
  targetName: string,
  pages: PageServing,
  plans: PlanSwitching,
  startTarget: StartTarget,
  part: number,
): void {
  const registers = contractParts[part - 1]
  if (registers === undefined) throw new Error(`no contract part ${part}`)
  const context = { targetName, pages, plans, startTarget }
  describe("contract", () => {
    for (const register of registers) register(context)
  })
}
