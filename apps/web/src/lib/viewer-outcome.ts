import type { ViewerState } from "@rafflink/core/http/json"
import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import type { GiveawayLoad, GiveawayView } from "../api/client.ts"

/** A winner as the page shows them; `entry` is null when the entry was deleted or only a push named them and the page never saw their entry. */
export type WonView = Extract<ViewerState, { kind: "won" }>

export interface GiveawayPageState {
  readonly giveaway: GiveawayView
  readonly me: ViewerState
}

/**
 * The page as the last push says it stands. The page compares the winners with its own viewer's id, so
 * the push can carry everyone's outcome and no viewer has to ask the server for theirs.
 */
export function applyViewerPush(load: GiveawayLoad, push: ViewerPush | null): GiveawayPageState {
  const me = load.me
  if (push === null) return { giveaway: load.giveaway, me }
  const giveaway = { ...load.giveaway, status: push.status, finished: push.finished }
  if (push.status !== "drawn" || me.kind === "signed-out" || me.kind === "not-entered") {
    return { giveaway, me }
  }
  const winner = push.winners.find((candidate) => candidate.platformUserId === me.userId)
  if (winner === undefined) return { giveaway, me: { kind: "not-won", userId: me.userId } }
  // The push names winners without their entry, so it is kept from the page's earlier answer when the
  // viewer was a winner or entered, and unknown when a reroll makes a viewer the page held as not-won the winner.
  const entry = me.kind === "won" || me.kind === "entered" ? me.entry : null
  return {
    giveaway,
    me: {
      kind: "won",
      userId: me.userId,
      n: winner.n,
      entry,
      claimRemainingMs: Math.max(0, winner.claimUntil - push.now),
      claim: winner.claim,
      chatClaimAvailable: push.chatClaimAvailable,
      // The push says nothing about the form; a viewer it makes the winner has not sent it yet.
      answers:
        me.kind === "won"
          ? me.answers
          : load.giveaway.rules.winnerForm.length === 0
            ? null
            : "open",
    },
  }
}
