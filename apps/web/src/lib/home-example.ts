import { demoLive, type DemoLive, type DemoNames } from "./demo-live.ts"
import {
  demoClaimMs,
  demoReducer,
  demoSteps,
  initialDemoState,
  type DemoState,
  type DemoStep,
} from "./demo-script.ts"

/** What the claim clock of the home page examples shows when they mount. */
export const exampleClaimLeftMs = 42_000

/** The steps of the demo giveaway the home page stage plays through, each with how long it stays on screen. */
export const stageSteps = [
  { step: "rising", ms: 5000 },
  { step: "drawing", ms: 4000 },
  { step: "won", ms: 6000 },
  { step: "claimed", ms: 5000 },
] as const satisfies readonly { readonly step: DemoStep; readonly ms: number }[]

export type StageStep = (typeof stageSteps)[number]["step"]

/** The step the stage rests on when it does not play: the winner with the claim clock running. */
export const restingStageStep = "won" satisfies StageStep

/**
 * The demo giveaway at `step`, reached with the demo's own reducer. From the draw on, the visitor was drawn
 * `exampleClaimLeftMs` before the end of the claim time.
 */
export function exampleDraw(
  step: StageStep,
  now: number,
  names: DemoNames,
): DemoLive & { readonly state: DemoState } {
  const state = demoSteps
    .slice(1, demoSteps.indexOf(step) + 1)
    .reduce((current) => demoReducer(current, { type: "advance", now }), initialDemoState)
  const shown =
    state.drawnAt === null ? state : { ...state, drawnAt: now - (demoClaimMs - exampleClaimLeftMs) }
  return { state: shown, ...demoLive(shown, now, (key) => key, names) }
}
