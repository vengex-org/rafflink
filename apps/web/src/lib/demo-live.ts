import type { Dispatch } from "react"
import type { Group } from "@rafflink/core/domain/groups"
import type {
  LiveSnapshot,
  LiveWinner,
  WinnerChatLine,
  WinnerClaim,
} from "@rafflink/core/room/giveaway-room"
import type { ClaimedVia, Entrant } from "@rafflink/core/room/rows"
import type { GiveawayView } from "../api/client.ts"
import {
  demoClaimMs,
  demoRules,
  demoViewerName,
  demoViewerSeq,
  type DemoAction,
  type DemoChatKey,
  type DemoState,
  type DemoStep,
} from "./demo-script.ts"
import type { LiveApi } from "./live-api.ts"

/** What the streamer's view needs to show the simulated giveaway: its snapshot, the people who entered and the public facts. */
export interface DemoLive {
  readonly snapshot: LiveSnapshot
  readonly entrants: readonly Entrant[]
  readonly facts: GiveawayView
}

export function demoLive(
  state: DemoState,
  now: number,
  chatText: (key: DemoChatKey) => string,
): DemoLive {
  const entrants = demoEntrants(state.entrants)
  const winners = demoWinners(state, entrants)
  const status = demoStatus(state.step)
  const unsettled = winners.some(
    (winner) => winner.claim.state === "waiting" || winner.claim.state === "expired",
  )
  return {
    entrants,
    facts: demoFacts(state),
    snapshot: {
      title: demoTitle,
      code: demoCode,
      status,
      closesAt: demoClosesAt(state),
      entrantCount: entrants.length,
      ticketTotal: entrants.reduce((sum, entrant) => sum + entrant.tickets, 0),
      winnerCount: state.winnerCount,
      entriesPerSecond: state.step === "rising" ? 1.4 : 0,
      lastNames: entrants.slice(-3).map((entrant) => entrant.displayName),
      winners,
      winnerChat: demoChatLines(state, chatText),
      rerollOpen: status === "drawn" && unsettled,
      rerollBlocked: null,
      roleRefreshFailures: 0,
      eventSubFailures: 0,
      drawAvailableAt: null,
      drawRequested: state.step === "drawing",
      shuffleNames:
        state.step === "drawing" ? entrants.slice(0, 12).map((entrant) => entrant.displayName) : [],
      now,
      chatClaimUnavailable: false,
    },
  }
}

/** The public facts of the simulated giveaway: what the viewer's page and the streamer's view both show. */
export function demoFacts(state: DemoState): GiveawayView {
  const status = demoStatus(state.step)
  return {
    code: demoCode,
    title: demoTitle,
    prize: "A gaming chair",
    streamerName: "Streamy",
    rules: demoRules,
    status,
    closesAt: demoClosesAt(state),
    claimSeconds: demoClaimMs / 1000,
    entrantCount: state.entrants,
    finished: status === "drawn",
    poll: { intervalMs: 1000, maxMs: 1000 },
  }
}

/** The live buttons of the streamer's view act on the simulated state; no request is sent. */
export function demoLiveApi(dispatch: Dispatch<DemoAction>): LiveApi {
  return {
    closeEntries: async () => {
      dispatch({ type: "close", now: Date.now() })
      return "closed"
    },
    drawWinners: async () => {
      dispatch({ type: "draw", now: Date.now() })
      return { kind: "drawn" }
    },
    markClaimed: async (_id, n) => {
      dispatch({ type: "mark", n, now: Date.now() })
      return "claimed"
    },
    rerollWinner: async (_id, n) => {
      dispatch({ type: "reroll", n, now: Date.now() })
      return "rerolled"
    },
    setWinnerCount: async (_id, count) => {
      dispatch({ type: "winnerCount", count })
      return "set"
    },
  }
}

function demoChatLines(
  { chat }: DemoState,
  chatText: (key: DemoChatKey) => string,
): WinnerChatLine[] {
  return chat.map(({ key, at }, index) => ({
    id: index + 1,
    name: demoViewerName,
    text: chatText(key),
    at,
  }))
}

const demoCode = "DEMO1"
const demoTitle = "Summer giveaway"

export function demoStatus(step: DemoStep): LiveSnapshot["status"] {
  switch (step) {
    case "closed":
    case "drawing":
      return "closed"
    case "won":
    case "claimed":
      return "drawn"
    case "open":
    case "entered":
    case "rising":
      return "open"
  }
}

const demoClosesAt = ({ step, closesAt }: DemoState) =>
  step === "entered" || step === "rising" ? closesAt : null

const crowd = [
  "Pixel_Pete",
  "nova_k",
  "BlueFalcon",
  "tomas_plays",
  "LunaByte",
  "grizzly_g",
  "Ada_Codes",
  "retro_rex",
  "SkyWalker77",
  "mintyfresh",
  "ZedHeadroom",
  "quiet_otter",
  "Kasia_B",
  "dr_waffles",
  "NightOwlNick",
  "hexa_gon",
  "Frostbyte",
  "lemon_drop",
  "CosmicCat",
  "rooster_r",
  "Wanda_W",
  "ironclad_io",
  "PaperPlane",
  "vlad_the_mad",
  "SunnyDee",
  "glitch_gal",
  "OakAndAsh",
  "turbo_tim",
  "Marble_M",
  "echo_eli",
]

// A fixed spread of tiers, mostly plain viewers, so the tier breakdown has something in each row.
const tiers: readonly Group[] = [
  "viewer",
  "viewer",
  "follower",
  "viewer",
  "follower",
  "sub_t1",
  "viewer",
  "vip",
  "follower",
  "sub_t2",
  "viewer",
  "moderator",
  "follower",
  "sub_t3",
]

/** The simulated entrants in the order they entered: the made-up crowd first, then the visitor, then whoever joined later. */
function demoEntrants(count: number): Entrant[] {
  return Array.from({ length: count }, (_, index) => {
    const seq = index + 1
    if (seq === demoViewerSeq) {
      return entrantAt(seq, demoViewerName, "follower")
    }
    const base = crowd[index % crowd.length] ?? "viewer"
    const name = index < crowd.length ? base : `${base}${seq}`
    return entrantAt(seq, name, tiers[index % tiers.length] ?? "viewer")
  })
}

function entrantAt(seq: number, displayName: string, group: Group): Entrant {
  return {
    seq,
    login: displayName.toLowerCase(),
    displayName,
    tickets: demoRules.tickets[group],
    group,
    profileImageUrl: null,
  }
}

function demoWinners(state: DemoState, entrants: readonly Entrant[]): LiveWinner[] {
  const visitor: LiveWinner[] =
    state.drawnAt === null
      ? []
      : [
          {
            n: 0,
            entrySeq: demoViewerSeq,
            displayName: demoViewerName,
            profileImageUrl: null,
            claimUntil: state.drawnAt + demoClaimMs,
            claim: pickClaim(
              state.firstRerolled,
              state.claimedAt,
              state.claimedVia ?? "rafflink",
              false,
            ),
          },
        ]
  const later = state.laterPicks.map((pick) => ({
    n: pick.n,
    entrySeq: pick.seq,
    displayName: entrants[pick.seq - 1]?.displayName ?? null,
    profileImageUrl: null,
    claimUntil: pick.claimUntil,
    claim: pickClaim(pick.rerolled, pick.claimedAt, "manual", pick.expired),
  }))
  return [...visitor, ...later]
}

function pickClaim(
  rerolled: boolean,
  claimedAt: number | null,
  via: ClaimedVia,
  expired: boolean,
): WinnerClaim {
  if (rerolled) return { state: "rerolled" }
  if (claimedAt !== null) return { state: "claimed", at: claimedAt, via }
  return { state: expired ? "expired" : "waiting" }
}
