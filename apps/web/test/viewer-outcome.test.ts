import { describe, expect, it } from "bun:test"
import type { ViewerState } from "@rafflink/core/http/json"
import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import type { GiveawayView } from "../src/api/client.ts"
import { applyViewerPush } from "../src/lib/viewer-outcome.ts"
import { giveaway } from "./fixtures.ts"

const withForm = { ...giveaway, rules: { ...giveaway.rules, winnerForm: ["name" as const] } }

const pushNaming: ViewerPush = {
  status: "drawn",
  finished: false,
  chatClaimAvailable: true,
  winners: [{ n: 0, platformUserId: "u1", claimUntil: 2000, claim: { state: "waiting" } }],
  now: 1000,
}

function answersAfterPush(me: ViewerState, loaded: GiveawayView = withForm): unknown {
  const state = applyViewerPush({ giveaway: loaded, me }, pushNaming)
  return state.me.kind === "won" ? state.me.answers : state.me.kind
}

describe("applyViewerPush winner form state", () => {
  it("opens the form for a viewer a push makes the winner of a giveaway with a form", () => {
    expect(answersAfterPush({ kind: "not-won", userId: "u1" })).toBe("open")
  })

  it("has no form state for a giveaway without a form", () => {
    expect(answersAfterPush({ kind: "not-won", userId: "u1" }, giveaway)).toBeNull()
  })

  it("keeps the form state of a viewer the page already held as the winner", () => {
    const won: ViewerState = {
      kind: "won",
      userId: "u1",
      n: 0,
      entry: null,
      claimRemainingMs: 1000,
      claim: { state: "waiting" },
      chatClaimAvailable: true,
      answers: "sent",
    }

    expect(answersAfterPush(won)).toBe("sent")
  })
})
