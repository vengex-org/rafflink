import { demoLive, type DemoLive } from "./demo-live.ts"
import {
  demoClaimMs,
  demoReducer,
  demoSteps,
  initialDemoState,
  type DemoState,
} from "./demo-script.ts"

/** What the claim clock of the home page examples shows when they mount. */
export const exampleClaimLeftMs = 42_000

/** The demo giveaway at the moment its visitor has just won, with `exampleClaimLeftMs` of the claim time left. */
export function exampleDraw(now: number): DemoLive & { readonly state: DemoState } {
  const state = demoSteps
    .slice(1, demoSteps.indexOf("won") + 1)
    .reduce((current) => demoReducer(current, { type: "advance", now }), initialDemoState)
  const drawn = { ...state, drawnAt: now - (demoClaimMs - exampleClaimLeftMs) }
  return { state: drawn, ...demoLive(drawn, now, (key) => key) }
}
