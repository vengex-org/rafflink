import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import type { GiveawayLoad } from "../api/client.ts"

/**
 * The page as the last push says it stands. The page compares the winners with its own viewer's id, so
 * the push can carry everyone's outcome and no viewer has to ask the server for theirs.
 */
export function applyViewerPush(load: GiveawayLoad, push: ViewerPush | null): GiveawayLoad {
  if (push === null) return load
  const { me } = load
  const giveaway = { ...load.giveaway, status: push.status, finished: push.finished }
  if (push.status !== "drawn" || me.kind === "signed-out" || me.kind === "not-entered") {
    return { giveaway, me }
  }
  const winner = push.winners.find((candidate) => candidate.platformUserId === me.userId)
  if (winner === undefined) return { giveaway, me: { kind: "not-won", userId: me.userId } }
  // The push names winners only, so their own entry comes from the page's earlier answer. A viewer
  // the page loaded as not-won has none; the page loads again for them (giveaway-page.tsx).
  const entry = me.kind === "won" ? me : me.kind === "entered" ? me.entry : null
  if (entry === null) return { giveaway, me }
  return {
    giveaway,
    me: {
      kind: "won",
      userId: me.userId,
      n: winner.n,
      tickets: entry.tickets,
      group: entry.group,
      claimRemainingMs: Math.max(0, winner.claimUntil - push.now),
      claim: winner.claim,
      chatClaimAvailable: push.chatClaimAvailable,
    },
  }
}
