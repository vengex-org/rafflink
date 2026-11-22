import type { Context } from "hono"
import { toHex } from "../lib/encoding.ts"
import type { Giveaway, OwnedOverlayThemes, StreamerBlock } from "../accounts/account-store.ts"
import type { OverlayTheme } from "../domain/overlay-theme.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import type { CloudflarePlan, PlanLimitOverrides, PlanLimits } from "../plan/plan-limits.ts"
import type { Usage, UsageAlert } from "../plan/usage.ts"
import type { QueueStats } from "../queue/token-queue.ts"
import type { Instant } from "../ports.ts"
import type {
  LiveSnapshot,
  Verification,
  VerifiedPick,
  WinnerClaim,
} from "../room/giveaway-room.ts"
import type { Entrant, EntrySummary, RoomStatus } from "../room/rows.ts"
import type { GrowthDay, SeriesMinute } from "../stats/series.ts"
import type { AdminLiveGiveawayJson } from "../stats/live-giveaways.ts"
import type { ReferralCount } from "../stats/stats-store.ts"
import type { Platform, PlatformCapabilities, SubscriberBadges } from "../platform/provider.ts"
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
  readonly platform: Platform
  readonly platformUserId: string
  readonly tickets: number
  readonly salt: string | null
}

/** The answer of the "Am I in?" lookup by login. */
export interface EnteredJson {
  readonly entered: boolean
}

/** Who runs the instance, as the privacy policy and the terms name them (the `OPERATOR_*` keys); `legalUpdated` is `LEGAL_UPDATED`, null when unset. */
export interface OperatorJson {
  readonly name: string
  readonly address: string | null
  readonly id: string | null
  readonly email: string
  readonly legalUpdated: string | null
}

/** Who the streamer cookie belongs to (`null` without a valid session), the deployment's support link (`DONATE_URL`, null when unset) and its operator (null while `OPERATOR_NAME` is unset). */
export interface SessionJson {
  readonly streamer: {
    readonly displayName: string
    readonly login: string
    readonly profileImageUrl: string | null
    /** False while OPEN_SIGNUP is off and no admin has approved the account: it may sign in but not create giveaways. */
    readonly canCreate: boolean
    readonly platform: Platform
    /** What the streamer's platform supports, so the create form offers only those rules and entry paths. */
    readonly capabilities: PlatformCapabilities
  } | null
  readonly donateUrl: string | null
  readonly operator: OperatorJson | null
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

/** The streamer's overlay theme, or the one a giveaway's overlay shows. */
export interface OverlayThemeJson {
  readonly theme: OverlayTheme
}

/** What the streamer edits for one giveaway's overlay. */
export type GiveawayOverlayThemesJson = OwnedOverlayThemes

/** The streamer's block list on the dashboard, newest first; `blockListMax` is how many it may hold. */
export interface BlockListJson {
  readonly blocks: readonly StreamerBlock[]
  readonly blockListMax: number
}

/** The subscriber badge image of each ticket group a subscriber can be in; `null` when none is known and the page shows a tier chip. */
export type BadgesJson = SubscriberBadges

/** The live snapshot the streamer's own page loads first; the overlay token lets it show the OBS link, the support link (`DONATE_URL`, null when unset) a quiet way to support the deployment. */
export type OwnerLiveSnapshot = LiveSnapshot & {
  readonly overlayToken: string
  readonly donateUrl: string | null
}

/** A moderator link as the streamer's live page lists it; its secret is shown once, when it is made. */
export interface ModeratorLinkJson {
  readonly id: string
  readonly requireMod: boolean
  readonly createdAt: Instant
}

/** The links of one giveaway that still work, oldest first. */
export interface ModeratorLinksJson {
  readonly links: readonly ModeratorLinkJson[]
}

/** A new link and the token its URL carries after `#`; the server keeps only a hash of the secret part. */
export interface CreatedModeratorLinkJson {
  readonly link: ModeratorLinkJson
  readonly token: string
}

/** What opening a moderator link answers: the giveaway whose moderator page the browser may now load. */
export interface OpenedModeratorLinkJson {
  readonly giveawayId: string
}

/** One page of the entrants table; `more` is true when entrants follow the last row. */
export interface EntrantsPage {
  readonly rows: readonly Entrant[]
  readonly more: boolean
}

/** The Cloudflare plan the app assumes and the limits it applies. */
export interface AdminPlanJson {
  readonly current: CloudflarePlan
  readonly limits: PlanLimits & { readonly overridden: PlanLimitOverrides }
}

/** What the admin page shows. */
export interface AdminUsageJson {
  /** Null: the target has no daily limit. "unavailable": the usage source did not answer. */
  readonly usage: Usage | null | "unavailable"
  /** Null on a target without a Cloudflare plan, and while the stored plan cannot be read. */
  readonly plan: AdminPlanJson | null
  /** The daily limits today's requests reached `alertPercent` of. */
  readonly alerts: readonly UsageAlert[]
  readonly alertPercent: number
  /** OPEN_SIGNUP: every streamer may create giveaways, so the page shows no access lists. */
  readonly signupOpen: boolean
  readonly queue: QueueStats
}

/**
 * Streamers by approval state, admins left out; each count stops at STREAMER_ACCESS_LIST_MAX and `truncated`
 * says it did.
 */
export interface AdminAccessCountsJson {
  readonly pending: number
  readonly approved: number
  readonly truncated: boolean
}

/** The admin page's live numbers, last hour and aggregates. Nothing in it identifies a viewer. */
export interface AdminStatsJson {
  readonly generatedAt: Instant
  /** Giveaways open now, all of them. */
  readonly openGiveaways: number
  /** The newest open giveaways, at most ADMIN_STATS_LIVE_ROOMS_MAX; the sums below cover only these. */
  readonly giveaways: readonly AdminLiveGiveawayJson[]
  readonly viewers: number
  readonly entriesLastMinute: number
  readonly claimsLastMinute: number
  readonly queue: QueueStats
  /** As in {@link AdminUsageJson}. */
  readonly usage: Usage | null | "unavailable"
  /** One point per minute, oldest first; the minute in progress has no room counts yet. */
  readonly series: readonly SeriesMinute[]
  /** One point per UTC day, oldest first. */
  readonly growth: readonly GrowthDay[]
  /** Streamers whose second giveaway came within `returningWithinDays` of their first. */
  readonly returningStreamers: number
  /** ADMIN_STATS_RETURN_DAYS. */
  readonly returningWithinDays: number
  /** Null while OPEN_SIGNUP is true: nobody waits for approval then. */
  readonly access: AdminAccessCountsJson | null
  readonly referrals: readonly ReferralCount[]
}

/** A streamer in the admin's access lists. `id` is the account id the approve and revoke calls take. */
export interface AdminStreamerJson {
  readonly id: string
  readonly login: string
  readonly displayName: string
  /** First sign-in. */
  readonly createdAt: number
  /** Null while the account waits for approval. */
  readonly approvedAt: number | null
}

/** One access list, newest first. `truncated`: more streamers exist than STREAMER_ACCESS_LIST_MAX shows. */
export interface AdminStreamerListJson {
  readonly streamers: readonly AdminStreamerJson[]
  readonly truncated: boolean
}

/** Who waits for approval and who is approved; admins are in neither list. */
export interface AdminStreamersJson {
  readonly pending: AdminStreamerListJson
  readonly approved: AdminStreamerListJson
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
/** The value a JSON body names under `name`; undefined when the body is not an object or lacks the field. */
export function objectField(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, name)) return undefined
  return Reflect.get(body, name)
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
