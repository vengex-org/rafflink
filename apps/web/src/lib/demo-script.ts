import type { GiveawayRules } from "@rafflink/core/domain/rules"
import type { ClaimedVia } from "@rafflink/core/room/rows"

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

/** A winner drawn after the visitor, who is always the first pick. */
export interface DemoPick {
  readonly n: number
  /** Which entrant it is: entrants are numbered in the order they entered, from 1. */
  readonly seq: number
  readonly claimUntil: number
  readonly claimedAt: number | null
  readonly rerolled: boolean
}

/** What the visitor's winner types in chat; `claim` is the line that carries the claim keyword. */
export const demoChatScript = ["thanks", "discord", "claim"] as const

export type DemoChatKey = (typeof demoChatScript)[number]

/** How long after the previous line (or the draw) the next one comes, per line of {@link demoChatScript}. */
export const demoChatDelaysMs: Readonly<Record<DemoChatKey, number>> = {
  thanks: 4000,
  discord: 5000,
  claim: 21_000,
}

/** The word a winner types in chat to claim; a line without it does not claim. */
export const demoClaimKeyword = "!claim"

/** One simulated giveaway, shared by the streamer's view and the viewer's view. */
export interface DemoState {
  readonly step: DemoStep
  readonly entrants: number
  /** When the visitor claimed, as the clock read at that step; null before. */
  readonly claimedAt: number | null
  /** How the visitor's pick was claimed; null until it is. */
  readonly claimedVia: ClaimedVia | null
  /** The lines the visitor's winner has written in chat, with the clock reading of each. */
  readonly chat: readonly { readonly key: DemoChatKey; readonly at: number }[]
  /** When entries close, set as the visitor enters; null before. */
  readonly closesAt: number | null
  /** When the visitor was drawn, as the clock read at that step; null before. */
  readonly drawnAt: number | null
  /** The streamer replaced the visitor's pick. */
  readonly firstRerolled: boolean
  readonly winnerCount: number
  readonly laterPicks: readonly DemoPick[]
}

/** Every action carries the clock reading it happens at, so the reducer stays pure and the claim time is the moment of the step. */
export type DemoAction =
  | { readonly type: "advance"; readonly now: number }
  | { readonly type: "join" }
  /** The streamer closes entries. */
  | { readonly type: "close"; readonly now: number }
  /** The streamer draws: the first winner, or the next one once the visitor has been drawn. */
  | { readonly type: "draw"; readonly now: number }
  | { readonly type: "mark"; readonly n: number; readonly now: number }
  | { readonly type: "reroll"; readonly n: number; readonly now: number }
  | { readonly type: "winnerCount"; readonly count: number }
  /** The visitor's winner writes the next line of {@link demoChatScript}. */
  | { readonly type: "chat"; readonly now: number }

export const demoInitialEntrants = 41

/** The visitor enters after everyone else, so they are the next entrant in line. */
export const demoViewerSeq = demoInitialEntrants + 1

export const initialDemoState: DemoState = {
  step: "open",
  entrants: demoInitialEntrants,
  claimedAt: null,
  claimedVia: null,
  chat: [],
  closesAt: null,
  drawnAt: null,
  firstRerolled: false,
  winnerCount: 1,
  laterPicks: [],
}

const enteredMs = 1500
const risingMs = 5000

export const demoClaimMs = 60_000

/**
 * How long a step lasts before the script moves on by itself; null waits for the visitor.
 * `won` ends a second before the claim countdown would reach 0, so the demo never shows "time is up".
 */
export const demoStepMs: Readonly<Record<DemoStep, number | null>> = {
  open: 3000,
  entered: enteredMs,
  rising: risingMs,
  closed: 1500,
  drawing: 2500,
  won: demoClaimMs - 1000,
  claimed: null,
}

/** The countdown the visitor sees from the moment they enter until entries close. */
export const demoClosesInMs = enteredMs + risingMs

export const demoJoinEveryMs = 700

export const demoViewerName = "mira_vex"

export const demoRules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: demoClaimKeyword,
}

export const demoEntry = { group: "follower", tickets: 2, enteredAt: 0 } as const

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "advance": {
      const next = demoSteps[demoSteps.indexOf(state.step) + 1]
      if (next === undefined) return state
      return {
        ...state,
        step: next,
        entrants: state.step === "open" ? state.entrants + 1 : state.entrants,
        closesAt: next === "entered" ? action.now + demoClosesInMs : state.closesAt,
        drawnAt: next === "won" ? action.now : state.drawnAt,
        claimedAt: next === "claimed" && !state.firstRerolled ? action.now : state.claimedAt,
        claimedVia: next === "claimed" && !state.firstRerolled ? "rafflink" : state.claimedVia,
      }
    }
    case "join":
      return state.step === "rising" ? { ...state, entrants: state.entrants + 1 } : state
    case "close":
      return entriesOpen(state) ? enterVisitor(state, "closed") : state
    case "draw":
      if (entriesOpen(state) || state.step === "closed") return enterVisitor(state, "drawing")
      return state.step === "won" || state.step === "claimed" ? addPick(state, action.now) : state
    case "mark":
      return markPick(state, action.n, action.now)
    case "reroll":
      return rerollPick(state, action.n, action.now)
    case "winnerCount":
      return { ...state, winnerCount: action.count }
    case "chat":
      return writeChat(state, action.now)
  }
}

const entriesOpen = ({ step }: DemoState) =>
  step === "open" || step === "entered" || step === "rising"

/** The visitor has entered by the time entries close, so a close before that counts them. */
function enterVisitor(state: DemoState, step: DemoStep): DemoState {
  return {
    ...state,
    step,
    entrants: state.step === "open" ? state.entrants + 1 : state.entrants,
  }
}

/** The visitor's pick exists from the moment they are drawn. */
const visitorDrawn = ({ drawnAt }: DemoState) => drawnAt !== null

const pickedSeqs = (state: DemoState): ReadonlySet<number> =>
  new Set([...(visitorDrawn(state) ? [demoViewerSeq] : []), ...state.laterPicks.map((p) => p.seq)])

/** Picks the next entrant in a fixed spread over the list, never the visitor and never one already drawn. */
function addPick(state: DemoState, now: number): DemoState {
  const taken = pickedSeqs(state)
  const free = Array.from({ length: state.entrants }, (_, index) => index + 1).filter(
    (seq) => seq !== demoViewerSeq && !taken.has(seq),
  )
  const seq = free[(taken.size * 7 + 3) % free.length]
  if (seq === undefined) return state
  const pick: DemoPick = {
    n: 1 + state.laterPicks.length,
    seq,
    claimUntil: now + demoClaimMs,
    claimedAt: null,
    rerolled: false,
  }
  return { ...state, laterPicks: [...state.laterPicks, pick] }
}

function markPick(state: DemoState, n: number, now: number): DemoState {
  if (n === 0) {
    if (!visitorDrawn(state) || state.firstRerolled || state.claimedAt !== null) return state
    return { ...state, step: "claimed", claimedAt: now, claimedVia: "manual" }
  }
  return {
    ...state,
    laterPicks: state.laterPicks.map((pick) =>
      pick.n === n && !pick.rerolled && pick.claimedAt === null
        ? { ...pick, claimedAt: now }
        : pick,
    ),
  }
}

/** Replaces an unclaimed pick with the next entrant in line. */
function rerollPick(state: DemoState, n: number, now: number): DemoState {
  if (n === 0) {
    if (!visitorDrawn(state) || state.firstRerolled || state.claimedAt !== null) return state
    return addPick({ ...state, firstRerolled: true, chat: [] }, now)
  }
  const target = state.laterPicks.find((pick) => pick.n === n)
  if (target === undefined || target.rerolled || target.claimedAt !== null) return state
  return addPick(
    {
      ...state,
      laterPicks: state.laterPicks.map((pick) =>
        pick === target ? { ...pick, rerolled: true } : pick,
      ),
    },
    now,
  )
}

/** Like the real room: a line is shown while the visitor's pick is open, and the one with the keyword also claims it. */
function writeChat(state: DemoState, now: number): DemoState {
  const key = demoChatScript[state.chat.length]
  if (key === undefined || state.step !== "won" || state.firstRerolled) return state
  const chat = [...state.chat, { key, at: now }]
  return key === "claim"
    ? { ...state, chat, step: "claimed", claimedAt: now, claimedVia: "chat" }
    : { ...state, chat }
}
