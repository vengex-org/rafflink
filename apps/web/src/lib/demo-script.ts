import type { GiveawayRules } from "@rafflink/core/domain/rules"

/** The scripted giveaway of the demo page, in the order it plays. */
export const demoSteps = [
  "open",
  "entered",
  "rising",
  "closed",
  "drawing",
  "won",
  "claimed",
] as const

export type DemoStep = (typeof demoSteps)[number]

export interface DemoState {
  readonly step: DemoStep
  readonly entrants: number
}

export type DemoAction = { readonly type: "advance" } | { readonly type: "join" }

export const initialDemoState: DemoState = { step: "open", entrants: 41 }

const enteredMs = 1500
const risingMs = 5000

/** How long a step lasts before the script moves on by itself; null waits for the visitor. */
export const demoStepMs: Readonly<Record<DemoStep, number | null>> = {
  open: 3000,
  entered: enteredMs,
  rising: risingMs,
  closed: 1500,
  drawing: 2500,
  won: null,
  claimed: null,
}

/** The countdown the visitor sees from the moment they enter until entries close. */
export const demoClosesInMs = enteredMs + risingMs

export const demoJoinEveryMs = 700

export const demoClaimMs = 60_000

export const demoViewerName = "mira_vex"

export const demoRules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

export const demoEntry = { group: "follower", tickets: 2, enteredAt: 0 } as const

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "advance": {
      const next = demoSteps[demoSteps.indexOf(state.step) + 1]
      if (next === undefined) return state
      return { step: next, entrants: state.step === "open" ? state.entrants + 1 : state.entrants }
    }
    case "join":
      return state.step === "rising" ? { ...state, entrants: state.entrants + 1 } : state
  }
}
