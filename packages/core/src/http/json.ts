import type { Context } from "hono"
import { toHex } from "../lib/encoding.ts"
import type { Giveaway } from "../accounts/account-store.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import type { Instant } from "../ports.ts"
import type {
  LiveSnapshot,
  Verification,
  VerifiedPick,
  WinnerClaim,
} from "../room/giveaway-room.ts"
import type { Entrant, EntrySummary, RoomStatus } from "../room/rows.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"

/**
 * What the giveaway page needs; the overlay token and the streamer's ids stay out. The page's response
 * is this object plus `me`, the {@link ViewerState} of the caller, which is never part of what is cached.
 */
export interface PublicGiveaway {
  readonly code: string
  readonly title: string | null
  readonly prize: string | null
  /** The streamer's display name. */
  readonly streamerName: string
  readonly rules: GiveawayRules
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly claimSeconds: number
  readonly entrantCount: number
  /** The draw is done and no pick can still be replaced by a reroll; the page then opens no push socket. */
  readonly finished: boolean
  /** How the page polls a queued entry: every `intervalMs`, for at most `maxMs`. */
  readonly poll: { readonly intervalMs: number; readonly maxMs: number }
}

/**
 * Where the viewer behind the viewer cookie stands in one giveaway; `signed-out` means no valid cookie.
 * Every other kind carries the viewer's platform user id, which the page compares with the winners of a push.
 */
export type ViewerState =
  | { readonly kind: "signed-out" }
  | { readonly kind: "not-entered"; readonly userId: string }
  | { readonly kind: "entered"; readonly userId: string; readonly entry: EntrySummary }
  | {
      readonly kind: "won"
      readonly userId: string
      readonly n: number
      /** The winner's own entry, so the won screen can show what the draw was weighted by; null once the entry was deleted. */
      readonly entry: Pick<EntrySummary, "tickets" | "group"> | null
      /** Computed by the server, so a wrong clock on the viewer's device does not change it. */
      readonly claimRemainingMs: number
      readonly claim: WinnerClaim
      /** Whether a chat message can still claim; false when the chat watch is off. */
      readonly chatClaimAvailable: boolean
    }
  | { readonly kind: "not-won"; readonly userId: string }

/** The public facts a visitor checks a draw against; `commitment` is null before the commit and for a giveaway drawn before commitments existed. */
export interface VerifyJson {
  readonly status: RoomStatus
  readonly entrantCount: number
  readonly ticketTotal: number
  /** How many winners the streamer planned; the draw may hold more picks. */
  readonly winnerCount: number
  readonly commitment: {
    /** Lower-case hex. */
    readonly merkleRoot: string
    /** The drand chain the room committed to, with the clock of its rounds. */
    readonly chainHash: string
    readonly genesisSeconds: number
    readonly periodSeconds: number
    /** The drand round whose randomness seeds the draw. */
    readonly round: number
    /** When the room committed, by the room's clock; the round must come later. */
    readonly committedAt: Instant
  } | null
  readonly picks: readonly VerifiedPick[]
}

/** The published leaves in leaf order: `hashes[i]` is lower-case hex and `tickets[i]` belongs to it. */
export interface LeavesJson {
  readonly hashes: readonly string[]
  readonly tickets: readonly number[]
}

/** The preimage of the signed-in viewer's own leaf; `salt` is lower-case hex, null until the room commits for an entry written before salts existed. */
export interface MyLeafJson {
  readonly platform: string
  readonly platformUserId: string
  readonly tickets: number
  readonly salt: string | null
}

/** Who the streamer cookie belongs to; `null` when there is no valid session. */
export interface SessionJson {
  readonly streamer: { readonly displayName: string; readonly login: string } | null
}

/** The streamer's own view of a giveaway, with the overlay token. */
export interface DashboardGiveaway {
  readonly id: string
  readonly code: string
  readonly title: string | null
  readonly prize: string | null
  readonly rules: GiveawayRules
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly claimSeconds: number
  readonly overlayToken: string
  readonly createdAt: Instant
}

/** The live snapshot the streamer's own page loads first; the overlay token lets it show the OBS link. */
export type OwnerLiveSnapshot = LiveSnapshot & { readonly overlayToken: string }

/** One page of the entrants table; `more` is true when entrants follow the last row. */
export interface EntrantsPage {
  readonly rows: readonly Entrant[]
  readonly more: boolean
}

export function verifyJson(verification: Verification): VerifyJson {
  const { commitment, ...rest } = verification
  return {
    ...rest,
    commitment:
      commitment === null
        ? null
        : {
            merkleRoot: toHex(commitment.merkleRoot),
            chainHash: commitment.chain.chainHash,
            genesisSeconds: commitment.chain.genesisSeconds,
            periodSeconds: commitment.chain.periodSeconds,
            round: commitment.drandRound,
            committedAt: commitment.committedAt,
          },
  }
}

export function dashboardGiveaway(giveaway: Giveaway): DashboardGiveaway {
  return {
    id: giveaway.id,
    code: giveaway.code,
    title: giveaway.title,
    prize: giveaway.prize,
    rules: giveaway.rules,
    status: giveaway.status,
    closesAt: giveaway.closesAt,
    claimSeconds: giveaway.claimSeconds,
    overlayToken: giveaway.overlayToken,
    createdAt: giveaway.createdAt,
  }
}

/** The query string the sign-in callback redirects the viewer's page with. */
export function outcomeQuery(outcome: CallbackOutcome): URLSearchParams {
  const query = new URLSearchParams({ entry: outcome.kind })
  switch (outcome.kind) {
    case "pending":
      query.set("ticket", outcome.ticket)
      break
    case "not-eligible":
      query.set("reason", outcome.reason)
      break
    case "entered":
    case "already-in":
    case "closed":
    case "rate-limited":
    case "dropped":
    case "try-again":
    case "invalid-state":
      break
  }
  return query
}

/** Body of a request, or undefined when it is not JSON. */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
