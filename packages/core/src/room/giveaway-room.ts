import type { ResolvedConfig } from "../config.ts"
import type { Actor } from "../domain/actor.ts"
import type { OverlayTheme } from "../domain/overlay-theme.ts"
import {
  evaluateEligibility,
  isEntryMessage,
  type EntryVia,
  type GiveawayRules,
  type Exclusion,
  type IneligibleReason,
  type RulesConfig,
  type ViewerFacts,
} from "../domain/rules.ts"
import {
  pickWinner,
  pickWinners,
  sortEntries,
  type DrawEntry,
  type Identity,
  type Winner,
} from "../lib/draw.ts"
import { drandChain, roundAtOrAfter, roundTime } from "../lib/drand.ts"
import { leafHash, merkleRoot, type LeafPreimage } from "../lib/merkle.ts"
import type { MinuteCounts } from "../stats/stats-store.ts"
import { hourMs, minuteMs, startOfMinute } from "../stats/time.ts"
import type {
  Alarm,
  Clock,
  Instant,
  LiveHub,
  Random,
  RandomnessBeacon,
  SqlRow,
  SqlValue,
  SyncSql,
} from "../ports.ts"
import { maxBoundParameters } from "../ports.ts"
import type {
  ChannelEntryEvent,
  ChannelViewer,
  ChatAudience,
  ChatMessage,
  ChatOpener,
  ChatSource,
  ChatterRoles,
  WatchTopics,
} from "../platform/chat-source.ts"
import {
  chatEntryRequestsSql,
  chatEntryWaitingSql,
  clearChatEntryRequestsSql,
  insertChatEntryRequestSql,
  takeChatEntryRequestSql,
  chatEntrantByLoginSql,
  claimsPerMinuteSql,
  claimsSinceCountSql,
  entrantsAfterSql,
  entriesPerMinuteSql,
  entryOfSql,
  headSeqSql,
  lastNamesSql,
  nextClaimDeadlineSql,
  lastClaimDeadlineSql,
  lastStandingDeadlineSql,
  undrawnEntrantSql,
  recentEntriesCountSql,
  entriesBetweenCountSql,
  firstUnreportedActivitySql,
  shuffleNamesSql,
  retainedDataSql,
  waitingPickOfChatterSql,
  watchedChattersSql,
  chatWatchedSql,
  winnerChatNameSql,
} from "./queries.ts"
import {
  parseChatRequest,
  parseDraw,
  parseEntrant,
  parseEntry,
  parseState,
  RoomRowError,
  RowReader,
  type ChatRequest,
  type ClaimedVia,
  type Commitment,
  type DrawRow,
  type Entrant,
  type EntrySummary,
  type RoomState,
  type RoomStatus,
} from "./rows.ts"

export type RoomConfig = RulesConfig
  & Pick<
    ResolvedConfig,
    | "chatBotLogins"
    | "roleRefreshSeconds"
    | "chatEntryCheckSeconds"
    | "chatEntryFollowerChecks"
    | "liveIntervalMs"
    | "liveLastNames"
    | "liveShuffleNames"
    | "liveWinnerImages"
    | "liveEntrantsPerPush"
    | "liveWinnerChatMax"
    | "liveRateWindowSeconds"
    | "mirrorRetrySeconds"
    | "rerollWindowSeconds"
    | "entryRetentionSeconds"
    | "drandChainHash"
    | "drandGenesisSeconds"
    | "drandPeriodSeconds"
    | "drandLeadSeconds"
    | "commitRetrySeconds"
    | "commitMaxAttempts"
    | "drandPublishMarginSeconds"
    | "drawMaxWinners"
    | "metricsRetentionHours"
    | "winnerFormRetentionSeconds"
  >

export interface RoomDeps {
  readonly sql: SyncSql
  readonly alarm: Alarm
  readonly live: LiveHub
  readonly clock: Clock
  readonly random: Random
  readonly config: RoomConfig
  /** Opens the chat of the giveaway's channel while the room takes chat entries or watches its winners. */
  readonly chat: ChatOpener
  /** Where the draw reads the round it committed to at close. */
  readonly beacon: RandomnessBeacon
}

/** What the room is created from: the giveaway as the account store holds it. */
export interface GiveawayInit {
  readonly id: string
  readonly platform: string
  readonly broadcasterId: string
  readonly title: string | null
  readonly code: string
  readonly rules: GiveawayRules
  readonly claimSeconds: number
  readonly closesAt: Instant | null
  /** How many winners the streamer plans to draw; the draw does not stop there. */
  readonly winnerCount: number
}

/** A viewer entering: who they are on the giveaway's platform and what the platform said about them. */
export type RoomViewer = Omit<ViewerFacts, "userId" | "isVip" | "isModerator" | "exclusion"> & {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  /** Null when the viewer has no picture on Twitch's image host. */
  readonly profileImageUrl: string | null
}

/** A chatter who typed the entry keyword, or a viewer who subscribed or redeemed, waiting for the caller of {@link GiveawayRoom.onAlarm} to check them. */
export interface ChatEntrantCheck {
  readonly platformUserId: string
  /** Whether being a follower changes if or with how many tickets they enter, so the follow has to be read. */
  readonly followerCheck: boolean
  /** Whether the subscription tier has to be read: a redemption carries none, unlike chat badges and sub events. */
  readonly tierCheck: boolean
}

/** The chatters one check reads, oldest first. */
export interface ChatEntrantsDuty {
  readonly platform: string
  readonly chatters: readonly ChatEntrantCheck[]
}

/** What the caller read about a checked chatter, for {@link GiveawayRoom.enterFromChat}. */
export interface CheckedChatter {
  readonly platformUserId: string
  /** False when the follow was not read because it changes nothing. */
  readonly isFollower: boolean
  /** Null when the account was not found; an unknown age fails a minimum. */
  readonly accountAgeDays: number | null
  readonly profileImageUrl: string | null
  /** The tier read for a `tierCheck`; null when not subscribed or not read, and then the request's own tier counts. */
  readonly subTier: ViewerFacts["subTier"]
}

/** What {@link GiveawayRoom.init} found: whether the excluded accounts are written, and which block list version the room holds. */
export interface RoomInitOutcome {
  readonly exclusionsLoaded: boolean
  readonly blockListVersion: number
}

/** The streamer's block list on the giveaway's platform at one `streamers.block_list_version`. */
export interface BlockList {
  readonly version: number
  readonly platformUserIds: readonly string[]
}

/** The accounts a room keeps out: the streamer's block list and the platform user ids of the winners of the streamer's recent giveaways. */
export interface RoomExclusions {
  readonly blocked: BlockList
  readonly recentWinners: readonly string[]
}

/** What the caller knows an entry must be checked against: the block list version the account store holds now. */
export interface EntryExpectation {
  readonly blockListVersion: number
}

/** The room cannot check an entry yet; the caller sends what is `missing`, then enters again. */
export type ExclusionsMissing = "exclusions" | "block-list"

export type EnterOutcome =
  | { readonly kind: "entered"; readonly entry: EntrySummary }
  | { readonly kind: "already-in"; readonly entry: EntrySummary }
  | { readonly kind: "not-eligible"; readonly reason: IneligibleReason }
  | { readonly kind: "closed" }
  | { readonly kind: "unavailable"; readonly missing: ExclusionsMissing }

export type CloseOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "not-open"; readonly status: RoomStatus }

export interface SetWinnerCountOutcome {
  readonly kind: "set"
}

export type RequestDrawOutcome =
  | { readonly kind: "requested" }
  | { readonly kind: "not-open"; readonly status: RoomStatus }

export type DrawOutcome =
  /** The batch in pick order; fewer picks than asked when every entrant got picked on the way. */
  | { readonly kind: "drawn"; readonly winners: readonly Winner[] }
  /** The committed drand round is not published yet; nothing was drawn and the alarm draws the batch once it is. */
  | { readonly kind: "round-pending"; readonly availableAt: Instant; readonly now: Instant }
  /** The beacon failed after its retries; nothing was drawn and a later call may draw. */
  | { readonly kind: "beacon-unavailable" }
  | { readonly kind: "not-closed" }
  | { readonly kind: "entries-deleted" }
  /** Every entrant is already picked. The first draw of a room nobody entered still moves it to drawn. */
  | { readonly kind: "no-entrants-left" }
  /** The batch would take the room past the picks `DRAW_MAX_WINNERS` allows; nothing was drawn. */
  | { readonly kind: "pick-limit" }
  /** Another draw wrote its pick first; nothing was drawn and a repeat draws the next one. */
  | { readonly kind: "try-again" }

export type RerollOutcome =
  | { readonly kind: "rerolled"; readonly replaced: number; readonly winner: Winner }
  | { readonly kind: "already-rerolled" }
  | { readonly kind: "already-claimed" }
  | { readonly kind: "unknown-pick" }
  | { readonly kind: "not-drawn" }
  | { readonly kind: "no-entrants-left" }
  | { readonly kind: "entries-deleted" }
  | { readonly kind: "reroll-window-over" }
  | { readonly kind: "try-again" }

export type ClaimOutcome =
  | { readonly kind: "claimed" }
  | { readonly kind: "already-claimed" }
  | { readonly kind: "expired" }
  | { readonly kind: "rerolled" }
  | { readonly kind: "not-a-winner" }

/** What the account store keeps of the room: the status, and the counts the public history and the dashboard list without waking the room. */
export interface RoomMirror {
  readonly status: RoomStatus
  readonly entrantCount: number
  /** The picks that were not rerolled. */
  readonly winners: number
  /** The picks whose winner claimed. */
  readonly claimed: number
  /** The claimed picks whose prize the streamer marked delivered. */
  readonly delivered: number
}

/** What the caller of {@link GiveawayRoom.onAlarm} still has to do, because it needs a port the room lacks. */
export interface AlarmDuties {
  /** Fetch the VIP and moderator lists, then call `replaceRoles` or `recordFailure`. */
  readonly refreshRoles: boolean
  /** Mirror {@link GiveawayRoom.mirrorState} to the account store, then call `markMirrored` with it. */
  readonly mirrorDue: boolean
  /** Call `commit`: the room is closed and has no commitment yet. */
  readonly commit: boolean
  /** Call `draw`: the streamer asked for it and the committed drand round is published. */
  readonly draw: boolean
  /** Add these minutes of entries and claims to the account store's per-minute counters; they are final and the room does not report them again. */
  readonly metrics: readonly MinuteCounts[]
  /** Read these chatters' profiles, and the follows and tiers they need, then call `enterFromChat`. Null when no check is due. */
  readonly chatEntrants: ChatEntrantsDuty | null
}

/** What an admin sees of a room that is open right now. */
export interface RoomCounts {
  readonly entrants: number
  readonly entriesLastMinute: number
  readonly claimsLastMinute: number
}

export type FailureKind = "role-refresh" | "eventsub"

export interface RoomSummary {
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly entrantCount: number
  readonly ticketTotal: number
  /** How many winners the streamer plans to draw; the draw does not stop there. */
  readonly winnerCount: number
  /** No chat claim is possible: the chat watch gave up, so a winner can only claim on the page or by the streamer's hand. */
  readonly chatClaimUnavailable: boolean
  /** Entries are open to a chat keyword but the chat watch gave up, so typing the keyword enters nobody. */
  readonly chatEntryOff: boolean
  /** Entries are open to subs or a channel point reward but the watch gave up, so those enter nobody. */
  readonly channelEntryOff: boolean
}

/** The room as a viewer's page loads it. */
export interface PublicSummary extends RoomSummary {
  /** The draw is done and nothing on a viewer's page can change any more: no pick is waiting, and none can be rerolled. */
  readonly finished: boolean
}

/** A winner's claim as the live page shows it. */
export type WinnerClaim =
  | { readonly state: "claimed"; readonly at: Instant; readonly via: ClaimedVia }
  | { readonly state: "waiting" | "expired" | "rerolled" }

export interface LiveWinner {
  readonly n: number
  /** The `seq` of the winner's entrant row; null when the entry is gone. */
  readonly entrySeq: number | null
  /** Kept with the pick after the entry is gone; null for a pick whose entry was deleted before names were kept. */
  readonly displayName: string | null
  /** Null when the entry is gone, has no picture, or the pick is older than the newest `LIVE_WINNER_IMAGES`. */
  readonly profileImageUrl: string | null
  readonly claimUntil: Instant
  readonly claim: WinnerClaim
}

/** A pick with who it went to. */
export interface WinnerPick extends LiveWinner, Identity {
  /** Same lifetime as {@link LiveWinner.displayName}. */
  readonly login: string | null
  readonly drawnAt: Instant
  readonly answers: PickAnswers
  /** When the streamer marked the prize delivered; null until then. */
  readonly deliveredAt: Instant | null
}

/**
 * Whether the winner of a pick can send the winner form: `open` while the claim can still come or came less than
 * `WINNER_FORM_RETENTION_SECONDS` ago, `sent` once they did, `closed` when the time is over, the pick was rerolled
 * or the prize was marked delivered first.
 */
export type PickAnswers = "open" | "sent" | "closed"

/** A winner's form answers as the room holds them: sealed by the caller, which alone holds the key. */
export interface SealedWinnerAnswers {
  readonly n: number
  readonly sealed: string
}

/** What {@link GiveawayRoom.saveWinnerAnswers} did; only the first sending of a claimed winner is kept. */
export type SaveAnswersOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "already-answered" }
  | { readonly kind: "not-claimed" }
  | { readonly kind: "form-closed" }
  | { readonly kind: "not-a-winner" }

/** What {@link GiveawayRoom.markDelivered} did. */
export type MarkDeliveredOutcome =
  | { readonly kind: "delivered" }
  | { readonly kind: "already-delivered" }
  | { readonly kind: "not-claimed" }
  | { readonly kind: "unknown-pick" }

/** What {@link GiveawayRoom.removeWinnerName} did: replaced the names, or found no pick with that number. */
export type RemoveWinnerNameOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "unknown-pick" }

/**
 * Whether the streamer can still reroll an unclaimed pick, and why not. `rerollBlocked` is `null`
 * while a reroll is open, before the draw, and while no unclaimed pick is left to reroll (every claim
 * is done); otherwise `"window-over"` once the reroll window after the last claim deadline has passed
 * (also when nobody is left), or `"nobody-left"` while the window is open but every entrant is drawn.
 */
export type RerollState =
  | { readonly rerollOpen: true; readonly rerollBlocked: null }
  | { readonly rerollOpen: false; readonly rerollBlocked: "window-over" | "nobody-left" | null }

/** One chat message of a winner as the live page shows it; `name` is the display name of the winner's entry, `id` counts the room's lines up from 1 so a page can tell a new line from an old one. */
export interface WinnerChatLine {
  readonly id: number
  readonly name: string
  readonly text: string
  readonly at: Instant
}

/** The snapshot as the OBS overlay sees it: viewers' chat text never reaches a shared screen. */
export type OverlaySnapshot = RoomSummary
  & RerollState & {
    readonly title: string | null
    readonly code: string
    readonly entriesPerSecond: number
    readonly lastNames: readonly string[]
    readonly winners: readonly LiveWinner[]
    readonly roleRefreshFailures: number
    readonly eventSubFailures: number
    /** When the committed drand round is published and a draw can start; null before the room has committed. */
    readonly drawAvailableAt: Instant | null
    /** The streamer pressed Draw before the round was published; the room draws by itself once it is. */
    readonly drawRequested: boolean
    /** Random entrant names for the shuffle animation while a draw is pending and after a draw, for the next pick; empty otherwise. They say nothing about who will be picked. */
    readonly shuffleNames: readonly string[]
    /** The room's clock when the snapshot was taken, so a page measures `drawAvailableAt` without trusting its own clock. */
    readonly now: Instant
  }

/** Who pressed the actions of one pick; null where nobody is known. */
export interface PickActors {
  readonly n: number
  readonly drawnBy: Actor | null
  readonly rerolledBy: Actor | null
  /** Set only for a claim marked by hand. */
  readonly claimMarkedBy: Actor | null
}

/** Who pressed the room's actions, so the live page tells the streamer's from a moderator link's; null where the room acted by itself or the action predates actors. */
export interface ActionActors {
  readonly closedBy: Actor | null
  readonly picks: readonly PickActors[]
}

/** The streamer's live page snapshot: the overlay's plus the winners' chat and who pressed what. */
export type LiveSnapshot = OverlaySnapshot & {
  readonly actors: ActionActors
  /** The newest chat messages of winners, newest last; kept in room memory only. */
  readonly winnerChat: readonly WinnerChatLine[]
  /** The chat watch is running, so a winner's message can still appear in `winnerChat`; false once it ended or gave up. */
  readonly winnerChatOpen: boolean
  /** How many more picks `DRAW_MAX_WINNERS` lets the room hold, rerolled picks counted; a batch larger than this is refused. */
  readonly picksLeft: number
}

/** A winner as every viewer's page sees them: the platform user id lets the page compare it with its own viewer, and nothing else identifies the person. */
export interface ViewerWinner {
  readonly n: number
  readonly platformUserId: string
  readonly claimUntil: Instant
  readonly claim: WinnerClaim
}

/** What a viewer's page needs to show the draw and claim outcome without asking the server. */
export interface ViewerOutcome {
  readonly status: RoomStatus
  /** Same meaning as {@link PublicSummary.finished}; the page stops listening. */
  readonly finished: boolean
  /** Whether a chat message can still claim; false when the chat watch is off. */
  readonly chatClaimAvailable: boolean
  readonly winners: readonly ViewerWinner[]
}

/** A {@link ViewerOutcome} with the room's clock, so the page measures claim times without trusting its own clock. */
export interface ViewerPush extends ViewerOutcome {
  readonly now: Instant
}

/** The entrants written since the previous push: `rows` continue after `fromSeq`; `truncated` means more arrived than fit. */
export interface EntrantsDelta {
  readonly fromSeq: number
  readonly rows: readonly Entrant[]
  readonly truncated: boolean
}

/** What every live page receives after a write: the snapshot and the new entrants. */
export type LivePush = LiveSnapshot & { readonly entrantsAfter: EntrantsDelta }

/** {@link LivePush} for the overlay. */
export type OverlayPush = OverlaySnapshot & { readonly entrantsAfter: EntrantsDelta }

/** What the overlay receives when the streamer saves the style it shows; it carries no snapshot. */
export interface OverlayThemePush {
  readonly theme: OverlayTheme
}

/** One published leaf: the hash of an entry and its tickets, with no name. */
export interface Leaf {
  readonly hash: Uint8Array<ArrayBuffer>
  readonly tickets: number
}

/** A leaf preimage as its entrant may see it; `salt` is null for an entry written before salts existed and not yet committed. */
export type EntryLeaf = Omit<LeafPreimage, "salt"> & {
  readonly salt: Uint8Array<ArrayBuffer> | null
}

/** A pick as the verify page checks it; `leafIndex` is null for a pick drawn before commitments existed. */
export interface VerifiedPick {
  readonly n: number
  readonly leafIndex: number | null
  readonly rerolled: boolean
}

/** What anyone may check about a draw. `commitment` is null before the commit and for a room drawn before commitments existed. */
export interface Verification {
  readonly status: RoomStatus
  readonly entrantCount: number
  readonly ticketTotal: number
  readonly winnerCount: number
  readonly commitment: Commitment | null
  readonly picks: readonly VerifiedPick[]
}

/**
 * The state and rules of one giveaway over its own SQLite database. The room owns the giveaway's
 * status: the caller mirrors it to the account store through {@link GiveawayRoom.onAlarm}.
 */
export class GiveawayRoom {
  private readonly sql: SyncSql
  private readonly alarm: Alarm
  private readonly live: LiveHub
  private readonly clock: Clock
  private readonly random: Random
  private readonly config: RoomConfig
  private readonly beacon: RandomnessBeacon
  private readonly openChat: ChatOpener
  // Opened on the first watch, when the room knows its platform; lost with the object.
  private chat: ChatSource | null = null
  private lastPushAt: Instant | null = null
  // Lost with the object; the first push after that carries no rows and the page fetches the gap.
  private lastPushedSeq: number | null = null
  private pushDueAt: Instant | null = null
  // Lost with the object; the first outcome after that is pushed again.
  private lastViewerOutcome: string | null = null
  private mirrorRetryAt: Instant | null = null
  // Lost with the object; the waiting chatters are stored, so the next alarm checks them at once.
  private chatCheckAt: Instant | null = null
  // What a chat message or channel event is matched against while entries are open to one of them, null
  // otherwise; set by every chat sync, so a message costs no read of the room state.
  private channelEntrySettings: ChannelEntrySettings | null = null
  // Set when the alarm ended a commit or a requested draw, so its live push shows the change.
  private givenUp = false
  // Lost with the object, which is also how a hibernating Durable Object forgets chat; display only.
  private winnerChat: readonly ChatterLine[] = []
  private winnerChatSeq = 0

  constructor(deps: RoomDeps) {
    this.sql = deps.sql
    this.alarm = deps.alarm
    this.live = deps.live
    this.clock = deps.clock
    this.random = deps.random
    this.config = deps.config
    this.beacon = deps.beacon
    this.openChat = deps.chat
  }

  /** Creates the room once; a second call with any giveaway changes nothing. */
  init(giveaway: GiveawayInit): RoomInitOutcome {
    this.sql.exec(
      `INSERT INTO room_state
         (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, closes_at, roles_refresh_at, winner_count)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        giveaway.platform,
        giveaway.id,
        giveaway.broadcasterId,
        giveaway.title,
        giveaway.code,
        JSON.stringify(giveaway.rules),
        giveaway.claimSeconds,
        giveaway.closesAt,
        this.clock.now(),
        giveaway.winnerCount,
      ],
    )
    this.reconcile()
    const state = this.readState()
    return { exclusionsLoaded: state.exclusionsLoaded, blockListVersion: state.blockListVersion }
  }

  /** Replaces the recent winners, applies the block list as {@link replaceBlocked} does, and marks the exclusions written. */
  loadExclusions(exclusions: RoomExclusions): void {
    const { platform } = this.readState()
    const removed = this.sql.transaction(() => {
      this.sql.exec("DELETE FROM excluded_users WHERE reason = 'recent-winner'", [])
      this.insertExclusions(platform, exclusions.recentWinners, "recent-winner")
      this.sql.exec("UPDATE room_state SET exclusions_loaded = 1 WHERE id = 1", [])
      return this.applyBlockList(exclusions.blocked)
    })
    if (removed) this.afterWrite()
  }

  /**
   * Replaces the streamer's block list; a list older than the one held changes nothing, so a late
   * write never undoes a newer edit. While entries are open, a blocked account's entry is removed;
   * once closed, the entrants are what the commitment covers and stay.
   */
  replaceBlocked(blocked: BlockList): void {
    const removed = this.sql.transaction(() => this.applyBlockList(blocked))
    if (removed) this.afterWrite()
  }

  /** Changes how many winners the streamer plans; the draw never reads it. */
  setWinnerCount(count: number): SetWinnerCountOutcome {
    this.sql.exec("UPDATE room_state SET winner_count = ? WHERE id = 1", [count])
    this.afterWrite()
    return { kind: "set" }
  }

  /**
   * One entry per account: a repeat returns the first entry and changes nothing. Fails closed: until
   * the excluded accounts are written, or while the room holds an older block list than `expected`,
   * it answers `unavailable` and writes nothing.
   */
  enter(viewer: RoomViewer, expected: EntryExpectation): EnterOutcome {
    const now = this.clock.now()
    const outcome = this.sql.transaction((): EnterOutcome => {
      const state = this.readState()
      if (!entriesOpen(state, now)) return { kind: "closed" }
      if (!state.rules.pageEntry) return { kind: "not-eligible", reason: "page-entry-off" }
      return this.writeEntry(state, viewer, pageEntry, expected, now)
    })
    if (outcome.kind === "entered") this.afterWrite()
    return outcome
  }

  /**
   * Enters the checked chatters who still wait, by the same rules as a page entry, with the roles their
   * chat badges showed; a chatter no longer waiting is skipped. Works while entries are open and, for the
   * last profile read, after the close until the commit; between the end time and the close nobody enters.
   * While the room cannot check exclusions against `expected`, every chatter stays waiting for the next check.
   */
  enterFromChat(checked: readonly CheckedChatter[], expected: EntryExpectation): void {
    const now = this.clock.now()
    const outcomes = this.sql.transaction(() => {
      const state = this.readState()
      if (!entriesOpen(state, now) && !awaitsCommit(state)) return []
      const missing = exclusionsMissing(state, expected)
      if (missing !== null) {
        const unavailable: EnterOutcome = { kind: "unavailable", missing }
        return [unavailable]
      }
      return checked.flatMap((chatter) => {
        const [row] = this.sql.exec(takeChatEntryRequestSql, [chatter.platformUserId])
        if (row === undefined) return []
        const request = parseChatRequest(row)
        const viewer = chatViewer(request, chatter)
        return [this.writeEntry(state, viewer, chatEntry(request), expected, now)]
      })
    })
    this.logChatEntries("check", outcomes)
    if (outcomes.some((outcome) => outcome.kind === "entered")) this.afterWrite()
    else this.reconcile()
  }

  /** Whether a chat entrant has this login, in any letter case; page entrants are never found. The "Am I in?" lookup answers nothing else. Logins are stored as the platform writes them, in lower case. */
  hasChatEntrant(login: string): boolean {
    const { platform } = this.readState()
    return this.sql.exec(chatEntrantByLoginSql, [platform, login.toLowerCase()]).length > 0
  }

  // One entry per account: a repeat returns the first entry and changes nothing. Runs inside the caller's transaction.
  private writeEntry(
    state: RoomState,
    viewer: RoomViewer,
    way: EntryWay,
    expected: EntryExpectation,
    now: Instant,
  ): EnterOutcome {
    const missing = exclusionsMissing(state, expected)
    if (missing !== null) return { kind: "unavailable", missing }
    const existing = this.sql.exec(entryOfSql, [state.platform, viewer.platformUserId])[0]
    if (existing !== undefined) return { kind: "already-in", entry: parseEntry(existing) }

    const eligibility = evaluateEligibility(
      state.rules,
      this.viewerFacts(state, viewer, way.roles),
      state.broadcasterId,
    )
    if (!eligibility.eligible) return { kind: "not-eligible", reason: eligibility.reason }

    // `entrant_count` only grows and moves in the same transaction, so the next `seq` never repeats.
    this.sql.exec(
      `INSERT INTO entries (seq, platform, platform_user_id, login, display_name, profile_image_url, group_name, tickets, entered_at, salt, via)
       VALUES ((SELECT entrant_count + 1 FROM room_state WHERE id = 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.platform,
        viewer.platformUserId,
        viewer.login,
        viewer.displayName,
        viewer.profileImageUrl,
        eligibility.group,
        eligibility.tickets,
        now,
        this.random.bytes(saltBytes),
        way.via,
      ],
    )
    this.sql.exec(
      "UPDATE room_state SET entrant_count = entrant_count + 1, ticket_total = ticket_total + ? WHERE id = 1",
      [eligibility.tickets],
    )
    return {
      kind: "entered",
      entry: { group: eligibility.group, tickets: eligibility.tickets, enteredAt: now },
    }
  }

  summary(): PublicSummary {
    const state = this.readState()
    return { ...summarize(state), finished: this.isFinished(state) }
  }

  /** The outcome a viewer's page connecting now starts from. */
  viewerPush(): ViewerPush {
    return { ...this.viewerOutcome(this.readState()), now: this.clock.now() }
  }

  /** The viewer's entry, `null` when they did not enter. */
  entryOf(viewer: Identity): EntrySummary | null {
    const row = this.sql.exec(entryOfSql, [viewer.platform, viewer.platformUserId])[0]
    return row === undefined ? null : parseEntry(row)
  }

  /** The entry behind the viewer's leaf with the salt only they may see, `null` when they did not enter. */
  leafOf(viewer: Identity): EntryLeaf | null {
    const row = this.sql.exec(
      "SELECT tickets, salt FROM entries WHERE platform = ? AND platform_user_id = ?",
      [viewer.platform, viewer.platformUserId],
    )[0]
    if (row === undefined) return null
    const reader = new RowReader("entries", row)
    return {
      platform: viewer.platform,
      platformUserId: viewer.platformUserId,
      tickets: reader.int("tickets"),
      salt: reader.nullableBlob("salt"),
    }
  }

  /** What anyone may check about the draw, without the leaf list. */
  verification(): Verification {
    const state = this.readState()
    return {
      status: state.status,
      entrantCount: state.entrantCount,
      ticketTotal: state.ticketTotal,
      winnerCount: state.winnerCount,
      commitment: state.commitment,
      picks: this.readDraws().map((draw) => ({
        n: draw.n,
        leafIndex: draw.leafIndex,
        rerolled: draw.rerolled,
      })),
    }
  }

  /** The published leaves in leaf order; `null` until the room has committed. */
  leaves(): readonly Leaf[] | null {
    if (this.readState().commitment === null) return null
    return this.sql
      .exec("SELECT data FROM leaves ORDER BY chunk", [])
      .flatMap((row) => decodeLeaves(new RowReader("leaves", row).blob("data")))
  }

  /** Up to `limit` entrants with a sequence number above `afterSeq`, oldest first. */
  entrants(query: { readonly afterSeq: number; readonly limit: number }): readonly Entrant[] {
    return this.sql.exec(entrantsAfterSql, [query.afterSeq, query.limit]).map(parseEntrant)
  }

  /** Stops entries. Idempotent: closing a room that is not open reports its status. */
  close(by: Actor | null): CloseOutcome {
    if (!this.closeOpenRoom(by)) return { kind: "not-open", status: this.readState().status }
    this.scheduleMirrorRetry(this.clock.now())
    this.afterOutcomeWrite()
    return { kind: "closed" }
  }

  /** Closes an open room and has the alarm draw the first `count` winners once the committed drand round is published. */
  requestDraw(count: number, by: Actor | null): RequestDrawOutcome {
    const closed = this.sql.transaction(() => {
      if (!this.closeOpenRoom(by)) return false
      this.sql.exec(
        "UPDATE room_state SET draw_requested = 1, draw_count = ?, draw_requested_by = ? WHERE id = 1",
        [count, by],
      )
      return true
    })
    if (!closed) return { kind: "not-open", status: this.readState().status }
    this.scheduleMirrorRetry(this.clock.now())
    this.afterOutcomeWrite()
    return { kind: "requested" }
  }

  /** Arms the alarm from the stored state; a room that was never initialised arms nothing. */
  armAlarm(): void {
    if (this.sql.exec("SELECT 1 FROM room_state WHERE id = 1", []).length === 0) return
    this.guarded("alarm", () => this.rearm())
  }

  /** Runs when the alarm fires: closes at the end time, pushes a held live update, reports what is left to the caller. */
  onAlarm(): AlarmDuties {
    const now = this.clock.now()
    const metrics = this.takeFinishedMinutes(now)
    let state = this.readState()
    let pushNow = this.pushDueAt !== null && now >= this.pushDueAt
    if (state.status === "open" && state.closesAt !== null && now >= state.closesAt) {
      pushNow = this.closeOpenRoom(null) || pushNow
      state = this.readState()
    }
    // The end of the chat watch changes the snapshot too, also when every pick is claimed and no reroll window runs.
    pushNow =
      (state.status === "drawn" && (this.rerollWindowOver() || this.chatWatchOver())) || pushNow
    if (this.deleteExpiredEntries(state, now)) {
      pushNow = true
      state = this.readState()
    }
    this.deleteExpiredAnswers(state, now)
    // Both write when they give up, so they run before the push that shows it.
    const commitDue = this.commitDue(state, now)
    const drawDue = this.drawDue(state, now)
    pushNow = this.givenUp || pushNow
    this.givenUp = false
    if (pushNow) this.guarded("live-push", () => this.pushLive())
    this.guarded("viewer-push", () => this.pushViewers())
    const refreshRoles =
      state.status === "open" && state.rolesRefreshAt !== null && now >= state.rolesRefreshAt
    if (refreshRoles) {
      this.sql.exec("UPDATE room_state SET roles_refresh_at = ? WHERE id = 1", [
        now + this.config.roleRefreshSeconds * 1000,
      ])
    }
    const mirrorDue = state.mirrorPending && now >= (this.mirrorRetryAt ?? now)
    if (mirrorDue) this.scheduleMirrorRetry(now)
    const chatEntrants = this.chatEntrantsDue(state, now)
    this.guarded("chat", () => {
      this.syncChat()
      this.chat?.onAlarm()
    })
    this.guarded("alarm", () => this.rearm())
    return {
      refreshRoles,
      mirrorDue,
      commit: commitDue,
      draw: drawDue,
      metrics,
      chatEntrants,
    }
  }

  // While entries are open: the oldest waiting chatters, with no more follow reads than one check may send;
  // the others wait for the next check, a period later. After the close: the last profile read of whoever
  // still waits, with no follows and the tiers of the oldest redeemers only, so a minimum account age judges
  // them on their real age and the read fits the subrequests of one invocation.
  private chatEntrantsDue(state: RoomState, now: Instant): ChatEntrantsDuty | null {
    const open = entriesOpen(state, now)
    if ((!open && !awaitsCommit(state)) || now < (this.chatCheckAt ?? now)) return null
    const rows = this.sql.exec(chatEntryRequestsSql, [
      open ? chatEntrantsPerCheck : chatEntrantsPerLastRead,
    ])
    if (rows.length === 0) return null
    this.chatCheckAt = now + this.config.chatEntryCheckSeconds * 1000
    if (!open) {
      return {
        platform: state.platform,
        chatters: rows.map((row, index) => {
          const request = parseChatRequest(row)
          return {
            platformUserId: request.platformUserId,
            followerCheck: false,
            tierCheck: request.via === "points" && index < tierChecksPerLastRead,
          }
        }),
      }
    }
    const chatters: ChatEntrantCheck[] = []
    let follows = 0
    for (const row of rows) {
      const request = parseChatRequest(row)
      const followerCheck = this.followerDecides(state, request)
      if (followerCheck && follows >= this.config.chatEntryFollowerChecks) continue
      if (followerCheck) follows += 1
      chatters.push({
        platformUserId: request.platformUserId,
        followerCheck,
        tierCheck: request.via === "points",
      })
    }
    return { platform: state.platform, chatters }
  }

  // The account age is left out: it is read for everyone, and an age that refuses makes the follow pointless anyway.
  private followerDecides(state: RoomState, request: ChatRequest): boolean {
    const rules: GiveawayRules = { ...state.rules, minAccountAgeDays: null }
    const outcomeAs = (isFollower: boolean) =>
      evaluateEligibility(
        rules,
        this.viewerFacts(
          state,
          chatViewer(request, { ...uncheckedChatter, isFollower }),
          request.roles,
        ),
        state.broadcasterId,
      )
    const follower = outcomeAs(true)
    const other = outcomeAs(false)
    if (!follower.eligible || !other.eligible) return follower.eligible !== other.eligible
    return follower.tickets !== other.tickets
  }

  // A requested draw is due from the time of its round; a round still missing after the publish margin is a broken beacon, so the request ends and the streamer presses Draw again.
  private drawDue(state: RoomState, now: Instant): boolean {
    const window = this.requestedDrawWindow(state)
    if (window === null || now < (state.drawRetryAt ?? window.from + drawLagMs)) return false
    if (now <= window.until) {
      // The next try is stored, so a rewrite of the alarm by another write cannot push it back.
      this.sql.exec("UPDATE room_state SET draw_retry_at = ? WHERE id = 1", [
        now + this.periodMs(state),
      ])
      return true
    }
    this.sql.exec("UPDATE room_state SET draw_requested = 0, draw_retry_at = NULL WHERE id = 1", [])
    console.warn("requested draw gave up", { giveawayId: state.giveawayId })
    this.givenUp = true
    return false
  }

  // Whether a requested draw can still happen: the commit is pending or published and the round is not too late. A request that cannot is not shown as one.
  private drawStillPossible(state: RoomState): boolean {
    if (!state.drawRequested || state.status !== "closed" || state.entriesDeleted) return false
    return state.commitment === null
      ? !state.commitGaveUp
      : this.requestedDrawWindow(state) !== null
  }

  private requestedDrawWindow(state: RoomState): { from: Instant; until: Instant } | null {
    if (
      !state.drawRequested
      || state.status !== "closed"
      || state.commitment === null
      || state.entriesDeleted
    ) {
      return null
    }
    const from = roundTime(state.commitment.chain, state.commitment.drandRound)
    return { from, until: from + this.config.drandPublishMarginSeconds * 1000 }
  }

  // The round time, then one try per drand period until the margin is over; one more wake after it ends the request.
  private drawWake(state: RoomState): Instant | null {
    const window = this.requestedDrawWindow(state)
    if (window === null || state.commitment === null) return null
    if (this.clock.now() > window.until) return this.clock.now()
    return Math.min(state.drawRetryAt ?? window.from + drawLagMs, window.until + 1)
  }

  private periodMs(state: RoomState): number {
    if (state.commitment === null) throw new Error("a draw is due only after the commit")
    return state.commitment.chain.periodSeconds * 1000
  }

  // Each alarm that asks for a commit is an attempt and waits twice as long as the one before. The wake after the last
  // attempt finds the limit reached, logs it and arms nothing more; `draw` still commits when someone draws.
  private commitDue(state: RoomState, now: Instant): boolean {
    if (!awaitsCommit(state) || state.commitGaveUp || now < this.commitWaitUntil(state, now)) {
      return false
    }
    if (state.commitAttempts >= this.config.commitMaxAttempts) {
      this.sql.exec(
        "UPDATE room_state SET commit_gave_up = 1, draw_requested = 0, draw_retry_at = NULL WHERE id = 1",
        [],
      )
      this.givenUp = true
      console.error("room commit gave up", {
        giveawayId: state.giveawayId,
        attempts: state.commitAttempts,
      })
      return false
    }
    this.sql.exec(
      "UPDATE room_state SET commit_attempts = commit_attempts + 1, commit_retry_at = ? WHERE id = 1",
      [now + this.config.commitRetrySeconds * 1000 * 2 ** state.commitAttempts],
    )
    return true
  }

  // The next commit attempt, and while chatters still wait for their last profile read, not before two
  // check periods after the close: one for the read, one for its retry. The commit enters whoever is left.
  private commitWaitUntil(state: RoomState, now: Instant): Instant {
    const retryAt = state.commitRetryAt ?? now
    if (state.closedAt === null || this.sql.exec(chatEntryWaitingSql, []).length === 0)
      return retryAt
    return Math.max(retryAt, state.closedAt + 2 * this.config.chatEntryCheckSeconds * 1000)
  }

  /** What the account store should hold of the room now. */
  mirrorState(): RoomMirror {
    const state = this.readState()
    const draws = this.readDraws()
    return {
      status: state.status,
      entrantCount: state.entrantCount,
      winners: draws.filter((draw) => !draw.rerolled).length,
      claimed: draws.filter((draw) => draw.claim.state === "claimed").length,
      delivered: draws.filter((draw) => draw.deliveredAt !== null).length,
    }
  }

  /** Clears the pending mirror once `mirrored` reached the account store; a room that changed since stays pending. */
  markMirrored(mirrored: RoomMirror): void {
    const current = this.mirrorState()
    if (
      current.status === mirrored.status
      && current.entrantCount === mirrored.entrantCount
      && current.winners === mirrored.winners
      && current.claimed === mirrored.claimed
      && current.delivered === mirrored.delivered
    ) {
      this.sql.exec("UPDATE room_state SET mirror_pending = 0 WHERE id = 1", [])
    }
    this.guarded("alarm", () => this.rearm())
  }

  /**
   * Commits a closed room to its entrants and to a drand round: enters the chatters still waiting for a
   * check, as not following and of unknown age, then salts every entry that has none (one
   * written before salts existed), then stores the Merkle root over the sorted leaves, the round and the
   * leaf list. Leaves an open, a committed and a drawn room alone; two calls at once commit once.
   */
  async commit(): Promise<void> {
    const state = this.readState()
    if (!awaitsCommit(state)) return
    this.enterUncheckedChatters(state)
    const entries = this.saltedEntries()
    const leaves = await Promise.all(
      entries.map(async (entry) => ({ hash: await leafHash(entry), tickets: entry.tickets })),
    )
    const root = await merkleRoot(leaves)
    const chain = drandChain(this.config)
    const now = this.clock.now()
    const round = roundAtOrAfter(chain, now + this.config.drandLeadSeconds * 1000)
    let committed = false
    this.sql.transaction(() => {
      const stored = this.sql.exec(
        `UPDATE room_state SET merkle_root = ?, drand_round = ?, committed_at = ?, drand_chain_hash = ?,
           drand_genesis_seconds = ?, drand_period_seconds = ?
         WHERE id = 1 AND status = 'closed' AND merkle_root IS NULL RETURNING id`,
        [root, round, now, chain.chainHash, chain.genesisSeconds, chain.periodSeconds],
      )
      if (stored.length === 0) return
      committed = true
      for (let from = 0; from < leaves.length; from += leavesPerChunk) {
        this.sql.exec("INSERT INTO leaves (chunk, data) VALUES (?, ?)", [
          from / leavesPerChunk,
          encodeLeaves(leaves.slice(from, from + leavesPerChunk)),
        ])
      }
    })
    if (committed) this.guarded("live-push", () => this.pushLive())
    this.guarded("alarm", () => this.rearm())
  }

  /**
   * Draws the next `count` winners in one transaction, so a batch is written whole or not at all. A
   * closed room commits if it has not, then draws from pick 0 with the randomness of the drand round it
   * committed to; a drawn room adds the next picks of the same seeded order, skipping every earlier pick.
   * A batch is the same picks as `count` draws one by one. While the round is missing it draws nothing,
   * uses no other randomness and has the alarm draw the batch once the round is published.
   */
  async draw(count: number, by: Actor | null): Promise<DrawOutcome> {
    const state = this.readState()
    const refusal = drawRefusal(state)
    if (refusal !== null) return refusal
    return state.status === "drawn"
      ? this.drawNext(state.seed, count, by)
      : this.drawOpening(count, by)
  }

  /**
   * Draws the requested first batch of a closed room and nothing else: a room that is already drawn is refused,
   * so the alarm never adds a pick. With a null `by` (the alarm) the picks belong to whoever pressed Draw while
   * entries were open.
   */
  async drawFirst(by: Actor | null): Promise<DrawOutcome> {
    const outcome = await this.drawOpening(this.readState().drawCount, by)
    // A batch over the limit never fits, so the alarm stops asking and the streamer draws fewer.
    if (outcome.kind === "pick-limit") {
      this.sql.exec(
        "UPDATE room_state SET draw_requested = 0, draw_retry_at = NULL WHERE id = 1",
        [],
      )
      this.afterWrite()
    }
    return outcome
  }

  private async drawOpening(count: number, by: Actor | null): Promise<DrawOutcome> {
    if (count > this.config.drawMaxWinners) return { kind: "pick-limit" }
    await this.commit()
    const state = this.readState()
    const refusal = drawRefusal(state)
    if (refusal !== null) return refusal
    if (state.status !== "closed") return { kind: "try-again" }
    if (state.commitment === null) throw new Error("a closed room has no commitment after commit")
    const { drandRound, chain } = state.commitment
    const answer = await this.beacon.fetchRound(chain.chainHash, drandRound)
    switch (answer.kind) {
      case "not-yet": {
        const availableAt = roundTime(chain, drandRound)
        // A round still missing long after its time is a broken beacon, not an early draw.
        if (this.clock.now() > availableAt + this.config.drandPublishMarginSeconds * 1000) {
          return { kind: "beacon-unavailable" }
        }
        this.sql.exec(
          "UPDATE room_state SET draw_requested = 1, draw_count = ?, draw_requested_by = COALESCE(?, draw_requested_by) WHERE id = 1 AND status = 'closed'",
          [count, by],
        )
        this.afterWrite()
        return { kind: "round-pending", availableAt, now: this.clock.now() }
      }
      case "unavailable":
        return { kind: "beacon-unavailable" }
      case "round":
        break
    }
    const seed = answer.round.randomness
    const winners = await pickWinners(seed, 0, count, this.readDrawEntries(), [])
    const now = this.clock.now()
    let flipped = false
    const outcome = this.sql.transaction((): DrawOutcome => {
      // The first winner gets a fresh chat watch even when the chat entry watch gave up.
      const moved = this.sql.exec(
        "UPDATE room_state SET status = 'drawn', seed = ?, draw_requested = 0, draw_retry_at = NULL, mirror_pending = 1, chat_unavailable = 0 WHERE id = 1 AND status = 'closed' AND entries_deleted = 0 RETURNING id",
        [seed],
      )
      if (moved.length === 0) return drawRefusal(this.readState()) ?? { kind: "try-again" }
      flipped = true
      if (winners.length === 0) return { kind: "no-entrants-left" }
      const drawnBy = by ?? state.drawRequestedBy
      for (const winner of winners) this.insertPick(winner, now, state.claimSeconds, drawnBy)
      return { kind: "drawn", winners }
    })
    if (flipped) {
      this.scheduleMirrorRetry(now)
      this.afterOutcomeWrite()
    }
    return outcome
  }

  private async drawNext(
    seed: Uint8Array<ArrayBuffer>,
    count: number,
    by: Actor | null,
  ): Promise<DrawOutcome> {
    const draws = this.readDraws()
    if (draws.length + count > this.config.drawMaxWinners) return { kind: "pick-limit" }
    const next = nextPickNumber(draws)
    const winners = await pickWinners(seed, next, count, this.readDrawEntries(), draws)
    if (winners.length === 0) return { kind: "no-entrants-left" }
    const now = this.clock.now()
    const { claimSeconds } = this.readState()
    const outcome = this.sql.transaction((): DrawOutcome => {
      if (this.readState().entriesDeleted) return { kind: "entries-deleted" }
      if (this.sql.exec("SELECT n FROM draws WHERE n >= ? LIMIT 1", [next]).length > 0) {
        return { kind: "try-again" }
      }
      for (const winner of winners) this.insertPick(winner, now, claimSeconds, by)
      // A new waiting winner gets a fresh chat watch even when the last one gave up.
      this.sql.exec("UPDATE room_state SET chat_unavailable = 0 WHERE id = 1", [])
      this.sql.exec(markMirrorPendingSql, [])
      return { kind: "drawn", winners }
    })
    if (outcome.kind === "drawn") {
      this.scheduleMirrorRetry(now)
      this.afterOutcomeWrite()
    }
    return outcome
  }

  /** Marks pick `n` rerolled and adds the next pick; a repeat for the same `n` changes nothing. */
  async reroll(n: number, by: Actor | null): Promise<RerollOutcome> {
    const state = this.readState()
    if (state.status !== "drawn") return { kind: "not-drawn" }
    if (state.entriesDeleted) return { kind: "entries-deleted" }
    const draws = this.readDraws()
    const refusal = rerollRefusal(draws.find((draw) => draw.n === n) ?? null)
    if (refusal !== null) return refusal
    if (this.rerollWindowOver()) return { kind: "reroll-window-over" }

    const next = nextPickNumber(draws)
    const picked = await pickWinner(state.seed, next, this.readDrawEntries(), draws)
    if (picked === null) return { kind: "no-entrants-left" }
    const winner = picked
    const now = this.clock.now()
    const outcome = this.sql.transaction((): RerollOutcome => {
      const current = rerollRefusal(this.readDraw(n))
      if (current !== null) return current
      if (this.readState().entriesDeleted) return { kind: "entries-deleted" }
      if (this.rerollWindowOver()) return { kind: "reroll-window-over" }
      if (this.sql.exec("SELECT n FROM draws WHERE n = ?", [next]).length > 0) {
        return { kind: "try-again" }
      }
      const marked = this.sql.exec(
        "UPDATE draws SET rerolled = 1, rerolled_by = ? WHERE n = ? AND rerolled = 0 AND claimed_at IS NULL RETURNING n",
        [by, n],
      )
      if (marked.length === 0) return rerollRefusal(this.readDraw(n)) ?? { kind: "unknown-pick" }
      this.insertPick(winner, now, state.claimSeconds, by)
      // A new waiting winner gets a fresh chat watch even when the last one gave up.
      this.sql.exec("UPDATE room_state SET chat_unavailable = 0 WHERE id = 1", [])
      this.sql.exec(markMirrorPendingSql, [])
      return { kind: "rerolled", replaced: n, winner }
    })
    if (outcome.kind === "rerolled") {
      this.scheduleMirrorRetry(now)
      this.dropChatOf(draws.find((draw) => draw.n === n)?.platformUserId)
      this.afterOutcomeWrite()
    }
    return outcome
  }

  /**
   * Records that the winner of pick `n` claimed; the first claim wins, a later one is refused. A claim by the
   * streamer's hand has no deadline; `by` is who marked it and is kept only for such a claim.
   */
  claim(n: number, winner: Identity, via: ClaimedVia, by: Actor | null): ClaimOutcome {
    const now = this.clock.now()
    const markedBy = via === "manual" ? by : null
    const claimed = this.sql.transaction(() => {
      const rows = this.sql.exec(
        `UPDATE draws SET claimed_at = ?, claimed_via = ?, claim_marked_by = ?
         WHERE n = ? AND platform = ? AND platform_user_id = ?
           AND claimed_at IS NULL AND rerolled = 0 AND (? = 'manual' OR claim_until >= ?)
         RETURNING n`,
        [now, via, markedBy, n, winner.platform, winner.platformUserId, via, now],
      )
      if (rows.length === 1) this.sql.exec(markMirrorPendingSql, [])
      return rows
    })
    if (claimed.length === 1) {
      this.scheduleMirrorRetry(now)
      this.afterOutcomeWrite()
      return { kind: "claimed" }
    }
    return claimRefusal(this.readDraw(n), winner)
  }

  /** Replaces both role lists in one transaction, so a viewer never sees a half-refreshed list. */
  replaceRoles(vips: readonly string[], moderators: readonly string[]): void {
    const now = this.clock.now()
    const { platform } = this.readState()
    const rows: SqlValue[][] = [
      ...vips.map((id) => [platform, id, "vip", now]),
      ...moderators.map((id) => [platform, id, "moderator", now]),
    ]
    this.sql.transaction(() => {
      this.sql.exec("DELETE FROM channel_roles", [])
      this.insertChunked("channel_roles", roleColumns, rows)
      this.sql.exec("UPDATE room_state SET roles_refresh_at = ? WHERE id = 1", [
        now + this.config.roleRefreshSeconds * 1000,
      ])
    })
    this.guarded("alarm", () => this.rearm())
  }

  /** Closes the chat watch and nothing else, for the host that is shutting the room down. */
  closeChat(): void {
    this.chat?.close()
  }

  /** Counts a failure for the live page and logs it with the giveaway id; `cause` goes to the log untouched. */
  recordFailure(kind: FailureKind, cause: unknown): void {
    const column = failureColumns[kind]
    this.sql.exec(`UPDATE room_state SET ${column} = ${column} + 1 WHERE id = 1`, [])
    console.warn("room failure", { giveawayId: this.readState().giveawayId, kind, error: cause })
    this.afterWrite()
  }

  /** Every pick in order, rerolled ones included, with the identity the live page hides. */
  picks(): readonly WinnerPick[] {
    const now = this.clock.now()
    return this.readPickRows().map((row) => {
      const draw = parseDraw(row)
      const reader = new RowReader("draws", row)
      return {
        ...liveWinner(row, now),
        platform: draw.platform,
        platformUserId: draw.platformUserId,
        login: reader.nullableText("login"),
        drawnAt: reader.int("drawn_at"),
        answers: pickAnswers(draw, now, this.answersRetentionMs()),
        deliveredAt: draw.deliveredAt,
      }
    })
  }

  /**
   * Keeps the winner form answers of pick `n`, sealed by the caller, once: only from the pick's own account, after
   * the claim and while {@link PickAnswers} is `open`. The time of the sending stays when the answers are deleted.
   */
  saveWinnerAnswers(n: number, winner: Identity, sealed: string): SaveAnswersOutcome {
    const now = this.clock.now()
    const saved = this.sql.transaction(() => {
      const answered = this.sql.exec(
        `UPDATE draws SET answered_at = ?
         WHERE n = ? AND platform = ? AND platform_user_id = ?
           AND claimed_at > ? AND answered_at IS NULL AND delivered_at IS NULL
         RETURNING n`,
        [now, n, winner.platform, winner.platformUserId, now - this.answersRetentionMs()],
      )
      if (answered.length === 0) return false
      this.sql.exec("INSERT INTO winner_answers (n, sealed) VALUES (?, ?)", [n, sealed])
      return true
    })
    if (saved) {
      this.guarded("alarm", () => this.rearm())
      return { kind: "saved" }
    }
    return answersRefusal(this.readDraw(n), winner, now, this.answersRetentionMs())
  }

  /** The sealed answers the room still holds, by pick. */
  winnerAnswers(): readonly SealedWinnerAnswers[] {
    return this.sql.exec("SELECT n, sealed FROM winner_answers ORDER BY n", []).map((row) => {
      const reader = new RowReader("winner_answers", row)
      return { n: reader.int("n"), sealed: reader.text("sealed") }
    })
  }

  /** Records that the prize of claimed pick `n` was delivered and deletes its answers: the streamer needs them no more. */
  markDelivered(n: number): MarkDeliveredOutcome {
    const now = this.clock.now()
    const outcome = this.sql.transaction((): MarkDeliveredOutcome => {
      const marked = this.sql.exec(
        "UPDATE draws SET delivered_at = ? WHERE n = ? AND claimed_at IS NOT NULL AND delivered_at IS NULL RETURNING n",
        [now, n],
      )
      if (marked.length === 1) {
        this.sql.exec("DELETE FROM winner_answers WHERE n = ?", [n])
        this.sql.exec(markMirrorPendingSql, [])
        return { kind: "delivered" }
      }
      const draw = this.readDraw(n)
      if (draw === null) return { kind: "unknown-pick" }
      return draw.deliveredAt === null ? { kind: "not-claimed" } : { kind: "already-delivered" }
    })
    if (outcome.kind === "delivered") {
      this.scheduleMirrorRetry(now)
      this.guarded("alarm", () => this.rearm())
    }
    return outcome
  }

  /** Replaces the names of pick `n`, and of its entry while that exists, with "removed" and drops the entry's picture, for a winner who asked the operator to be removed. The pick, its claim and the draw proof stay. */
  removeWinnerName(n: number): RemoveWinnerNameOutcome {
    const outcome = this.sql.transaction((): RemoveWinnerNameOutcome => {
      const [pick] = this.sql.exec(
        "UPDATE draws SET login = ?, display_name = ? WHERE n = ? RETURNING platform, platform_user_id",
        [removedName, removedName, n],
      )
      if (pick === undefined) return { kind: "unknown-pick" }
      const reader = new RowReader("draws", pick)
      this.sql.exec(
        "UPDATE entries SET login = ?, display_name = ?, profile_image_url = NULL WHERE platform = ? AND platform_user_id = ?",
        [removedName, removedName, reader.text("platform"), reader.text("platform_user_id")],
      )
      return { kind: "removed" }
    })
    if (outcome.kind === "removed") this.afterWrite()
    return outcome
  }

  /** Sends the connected overlays a style the streamer saved. The room stores nothing: an overlay that connects later reads the style itself. */
  pushOverlayTheme(theme: OverlayTheme): void {
    const push: OverlayThemePush = { theme }
    this.live.broadcastOverlay(JSON.stringify(push))
  }

  /** Entries written per second in the `windowSeconds` before `until`: what the token endpoint let through for this giveaway. */
  entriesPerSecondBefore(until: Instant, windowSeconds: number): number {
    const row = this.sql.exec(entriesBetweenCountSql, [until - windowSeconds * 1000, until])[0]
    return row === undefined ? 0 : new RowReader("entries", row).int("c") / windowSeconds
  }

  /** The counts the admin page shows for this room: the entrants so far, and the entries and claims of the last minute. */
  liveCounts(): RoomCounts {
    const since = this.clock.now() - minuteMs
    return {
      entrants: this.readState().entrantCount,
      entriesLastMinute: this.count(recentEntriesCountSql, [since]),
      claimsLastMinute: this.count(claimsSinceCountSql, [since]),
    }
  }

  liveSnapshot(): LiveSnapshot {
    const state = this.readState()
    const now = this.clock.now()
    const windowSeconds = this.config.liveRateWindowSeconds
    const recent = this.sql.exec(recentEntriesCountSql, [now - windowSeconds * 1000])[0]
    const lastNames = this.sql
      .exec(lastNamesSql, [this.config.liveLastNames])
      .map((row) => new RowReader("entries", row).text("display_name"))
    const rows = this.readPickRows()
    const withImages = rows.length - this.config.liveWinnerImages
    const winners = rows.map((row, index) => {
      const winner = liveWinner(row, now)
      return index < withImages ? { ...winner, profileImageUrl: null } : winner
    })
    return {
      ...summarize(state),
      title: state.title,
      code: state.code,
      entriesPerSecond:
        recent === undefined ? 0 : new RowReader("entries", recent).int("c") / windowSeconds,
      lastNames,
      winners,
      winnerChat: this.winnerChat.map((entry) => entry.line),
      winnerChatOpen: this.winnerChatWatched(state),
      picksLeft: Math.max(0, this.config.drawMaxWinners - winners.length),
      actors: { closedBy: state.closedBy, picks: rows.map(pickActors) },
      ...this.rerollState(state),
      roleRefreshFailures: state.roleRefreshFailures,
      eventSubFailures: state.eventSubFailures,
      now,
      drawAvailableAt:
        state.commitment === null
          ? null
          : roundTime(state.commitment.chain, state.commitment.drandRound),
      drawRequested: this.drawStillPossible(state),
      shuffleNames: this.shuffleNames(state),
    }
  }

  // Closed and either asked to draw or committed to a round, so the animation can run before the pick exists; and drawn, where the next draw or a reroll brings its pick with no earlier pending state.
  private shuffleNames(state: RoomState): string[] {
    const shuffleable =
      state.status === "drawn"
      || (state.status === "closed" && (this.drawStillPossible(state) || state.commitment !== null))
    if (!shuffleable || state.entriesDeleted) return []
    return this.sql
      .exec(shuffleNamesSql, [this.config.liveShuffleNames])
      .map((row) => new RowReader("entries", row).text("display_name"))
  }

  private readState(): RoomState {
    const row = this.sql.exec("SELECT * FROM room_state WHERE id = 1", [])[0]
    if (row === undefined) throw new Error("room is not initialised")
    return parseState(row, this.config)
  }

  private readPickRows(): SqlRow[] {
    return this.sql.exec(
      `SELECT d.n, d.platform, d.platform_user_id, d.drawn_at, d.claim_until, d.claimed_at, d.claimed_via, d.rerolled, d.leaf_index, d.login, d.display_name, d.drawn_by, d.rerolled_by, d.claim_marked_by, d.answered_at, d.delivered_at, e.profile_image_url, e.seq
       FROM draws d LEFT JOIN entries e ON e.platform = d.platform AND e.platform_user_id = d.platform_user_id
       ORDER BY d.n`,
      [],
    )
  }

  private readDraws(): DrawRow[] {
    return this.sql.exec("SELECT * FROM draws ORDER BY n", []).map(parseDraw)
  }

  private readDraw(n: number): DrawRow | null {
    const row = this.sql.exec("SELECT * FROM draws WHERE n = ?", [n])[0]
    return row === undefined ? null : parseDraw(row)
  }

  // Every entry as a leaf preimage in leaf order. An entry without a salt is given one in the same
  // synchronous step, so two commits at once read the same salts.
  private saltedEntries(): LeafPreimage[] {
    const rows = this.sql.exec("SELECT platform, platform_user_id, tickets, salt FROM entries", [])
    return this.sql.transaction(() =>
      sortEntries(
        rows.map((row) => {
          const reader = new RowReader("entries", row)
          const platform = reader.text("platform")
          const platformUserId = reader.text("platform_user_id")
          const salt = reader.nullableBlob("salt") ?? this.writeSalt({ platform, platformUserId })
          return { platform, platformUserId, tickets: reader.int("tickets"), salt }
        }),
      ),
    )
  }

  private writeSalt(entry: Identity): Uint8Array {
    const salt = this.random.bytes(saltBytes)
    this.sql.exec("UPDATE entries SET salt = ? WHERE platform = ? AND platform_user_id = ?", [
      salt,
      entry.platform,
      entry.platformUserId,
    ])
    return salt
  }

  private readDrawEntries(): DrawEntry[] {
    return this.sql
      .exec("SELECT platform, platform_user_id, tickets FROM entries", [])
      .map((row) => {
        const reader = new RowReader("entries", row)
        return {
          platform: reader.text("platform"),
          platformUserId: reader.text("platform_user_id"),
          tickets: reader.int("tickets"),
        }
      })
  }

  // A role counts when the stored role lists or the chat badges show it: the lists are refreshed only now and then.
  private viewerFacts(
    state: RoomState,
    viewer: RoomViewer,
    chatRoles: ChatRoleBadges,
  ): ViewerFacts {
    const roles = this.sql
      .exec("SELECT role FROM channel_roles WHERE platform = ? AND platform_user_id = ?", [
        state.platform,
        viewer.platformUserId,
      ])
      .map((row) => new RowReader("channel_roles", row).text("role"))
    return {
      userId: viewer.platformUserId,
      isFollower: viewer.isFollower,
      subTier: viewer.subTier,
      isVip: chatRoles.isVip || roles.includes("vip"),
      isModerator: chatRoles.isModerator || roles.includes("moderator"),
      accountAgeDays: viewer.accountAgeDays,
      exclusion: this.exclusionOf(state, viewer),
    }
  }

  // A block outranks a recent win, so a blocked winner is told they are blocked.
  private exclusionOf(state: RoomState, viewer: RoomViewer): Exclusion | null {
    if (this.config.chatBotLogins.includes(viewer.login.toLowerCase())) return "blocked"
    const reasons = this.sql
      .exec("SELECT reason FROM excluded_users WHERE platform = ? AND platform_user_id = ?", [
        state.platform,
        viewer.platformUserId,
      ])
      .map((row) => new RowReader("excluded_users", row).oneOf("reason", exclusions))
    if (reasons.includes("blocked")) return "blocked"
    return reasons.includes("recent-winner") ? "recent-winner" : null
  }

  // Runs inside the caller's transaction; true when it removed an entry, so the caller pushes the live pages.
  private applyBlockList(blocked: BlockList): boolean {
    const state = this.readState()
    if (blocked.version < state.blockListVersion) return false
    this.sql.exec("DELETE FROM excluded_users WHERE reason = 'blocked'", [])
    this.insertExclusions(state.platform, blocked.platformUserIds, "blocked")
    this.sql.exec("UPDATE room_state SET block_list_version = ? WHERE id = 1", [blocked.version])
    if (state.status !== "open") return false
    let removed = 0
    let tickets = 0
    for (const id of blocked.platformUserIds) {
      const [row] = this.sql.exec(
        "DELETE FROM entries WHERE platform = ? AND platform_user_id = ? RETURNING tickets",
        [state.platform, id],
      )
      if (row === undefined) continue
      removed += 1
      tickets += new RowReader("entries", row).int("tickets")
    }
    if (removed === 0) return false
    this.sql.exec(
      "UPDATE room_state SET removed_entrants = removed_entrants + ?, ticket_total = ticket_total - ? WHERE id = 1",
      [removed, tickets],
    )
    console.info("blocked entries removed", { giveawayId: state.giveawayId, removed })
    return true
  }

  private insertExclusions(platform: string, ids: readonly string[], reason: Exclusion): void {
    this.insertChunked(
      "excluded_users",
      exclusionColumns,
      ids.map((id) => [platform, id, reason]),
    )
  }

  // Each statement binds at most `maxBoundParameters` values; the caller holds the transaction.
  private insertChunked(table: string, columns: readonly string[], rows: SqlValue[][]): void {
    const tuple = `(${columns.map(() => "?").join(", ")})`
    const perInsert = Math.floor(maxBoundParameters / columns.length)
    for (let from = 0; from < rows.length; from += perInsert) {
      const chunk = rows.slice(from, from + perInsert)
      this.sql.exec(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => tuple).join(", ")}`,
        chunk.flat(),
      )
    }
  }

  // The names are copied from the entry, so they outlive the entries' retention.
  private insertPick(winner: Winner, now: Instant, claimSeconds: number, by: Actor | null): void {
    const entry = "FROM entries WHERE platform = ? AND platform_user_id = ?"
    this.sql.exec(
      `INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until, leaf_index, drawn_by, login, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT login ${entry}), (SELECT display_name ${entry}))`,
      [
        winner.n,
        winner.platform,
        winner.platformUserId,
        now,
        now + claimSeconds * 1000,
        winner.leafIndex,
        by,
        winner.platform,
        winner.platformUserId,
        winner.platform,
        winner.platformUserId,
      ],
    )
  }

  // The chatters still waiting get their last profile read at once, before the commit enters the rest.
  private closeOpenRoom(by: Actor | null): boolean {
    const closed = this.sql.exec(
      "UPDATE room_state SET status = 'closed', closed_at = ?, closed_by = ?, mirror_pending = 1 WHERE id = 1 AND status = 'open' RETURNING id",
      [this.clock.now(), by],
    )
    if (closed.length > 0) this.chatCheckAt = null
    return closed.length > 0
  }

  // Chatters the last profile read did not reach enter in the order they asked, as not following and with an unknown account age.
  // A room whose exclusions were never written refuses them all (fail closed); the block list it holds is the newest it can check.
  private enterUncheckedChatters(state: RoomState): void {
    const now = this.clock.now()
    const heldBlockList: EntryExpectation = { blockListVersion: state.blockListVersion }
    const outcomes = this.sql.transaction(() => {
      const rows = this.sql.exec(chatEntryRequestsSql, [-1])
      this.sql.exec(clearChatEntryRequestsSql, [])
      return rows.map((row) => {
        const request = parseChatRequest(row)
        return this.writeEntry(
          state,
          chatViewer(request, uncheckedChatter),
          chatEntry(request),
          heldBlockList,
          now,
        )
      })
    })
    this.logChatEntries("commit", outcomes)
  }

  // Each batch of chat entrants is counted by outcome, so refusals are visible without a log line per chatter.
  private logChatEntries(stage: "check" | "commit", outcomes: readonly EnterOutcome[]): void {
    if (outcomes.length === 0) return
    const refused: Partial<Record<IneligibleReason, number>> = {}
    let entered = 0
    let alreadyIn = 0
    let unavailable = 0
    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case "entered":
          entered += 1
          break
        case "already-in":
          alreadyIn += 1
          break
        case "not-eligible":
          refused[outcome.reason] = (refused[outcome.reason] ?? 0) + 1
          break
        case "unavailable":
          unavailable += 1
          break
        case "closed":
          break
      }
    }
    console.info("chat entrants handled", {
      giveawayId: this.giveawayIdOrNull(),
      stage,
      entered,
      alreadyIn,
      refused,
      unavailable,
    })
  }

  // Counts, picks and claims stay: the winner list belongs to the giveaway, the entrants' data does not.
  private deleteExpiredEntries(state: RoomState, now: Instant): boolean {
    const deadline = this.retentionDeadline(state)
    if (deadline === null || now < deadline) return false
    this.sql.transaction(() => {
      this.sql.exec("DELETE FROM entries", [])
      this.sql.exec("DELETE FROM channel_roles", [])
      this.sql.exec("DELETE FROM excluded_users", [])
      this.sql.exec("UPDATE room_state SET entries_deleted = 1 WHERE id = 1", [])
    })
    console.info("room entries deleted", {
      giveawayId: state.giveawayId,
      entrantCount: state.entrantCount,
    })
    return true
  }

  // The winner form answers are personal data with their own clock, which starts at each claim.
  private deleteExpiredAnswers(state: RoomState, now: Instant): void {
    const deleted = this.sql.exec(
      "DELETE FROM winner_answers WHERE n IN (SELECT n FROM draws WHERE claimed_at <= ?) RETURNING n",
      [now - this.answersRetentionMs()],
    )
    if (deleted.length > 0) {
      console.info("winner answers deleted", {
        giveawayId: state.giveawayId,
        count: deleted.length,
      })
    }
  }

  // Null once no answers are held.
  private answersDeadline(): Instant | null {
    const row = this.sql.exec(
      "SELECT MIN(d.claimed_at) AS at FROM winner_answers a JOIN draws d ON d.n = a.n",
      [],
    )[0]
    const first = row === undefined ? null : new RowReader("draws", row).nullableInt("at")
    return first === null ? null : first + this.answersRetentionMs()
  }

  private answersRetentionMs(): number {
    return this.config.winnerFormRetentionSeconds * 1000
  }

  // Null while entries are open and once nothing is left to delete.
  private retentionDeadline(state: RoomState): Instant | null {
    if (state.closedAt === null || this.sql.exec(retainedDataSql, []).length === 0) return null
    return state.closedAt + this.config.entryRetentionSeconds * 1000
  }

  // The route mirrors at once; the alarm retries only after this delay, so the two do not race.
  private scheduleMirrorRetry(now: Instant): void {
    this.mirrorRetryAt = now + this.config.mirrorRetrySeconds * 1000
  }

  // A write the viewers' pages show: the same effects as {@link afterWrite}, plus the viewers' push.
  private afterOutcomeWrite(): void {
    this.guarded("viewer-push", () => this.pushViewers())
    this.afterWrite()
  }

  // Each effect after a commit runs in its own try: a failed push must not skip the alarm.
  private afterWrite(): void {
    this.guarded("live-push", () => this.pushLive())
    this.reconcile()
  }

  private reconcile(): void {
    this.guarded("chat", () => this.syncChat())
    this.guarded("alarm", () => this.rearm())
  }

  // The watcher runs while entries are open to a chat keyword, subs or a reward, and from the draw until the
  // reroll window after the last pick's claim time ends, as long as a pick is not rerolled; never after it gave
  // up, until a new pick clears that. Closing forgets the messages.
  private syncChat(): void {
    const state = this.readState()
    const { rules } = state
    this.channelEntrySettings =
      state.status === "open" && takesChannelEntries(rules)
        ? {
            keyword: rules.chatKeyword,
            subEntry: rules.subEntry && !state.channelEntryUnavailable,
            pointsRewardId: state.channelEntryUnavailable ? null : (rules.pointsReward?.id ?? null),
            platform: state.platform,
            broadcasterId: state.broadcasterId,
            closesAt: state.closesAt,
          }
        : null
    if (this.chatWatchOpen(state)) {
      this.chat ??= this.openChatSource(state.platform)
      this.chat.open(this.chatAudience(state))
      this.sql.exec("UPDATE room_state SET chat_watched = 1 WHERE id = 1 AND chat_watched = 0", [])
      return
    }
    // A source lost with the object may still hold a watch at the platform, which a fresh one closes.
    if (this.chat === null && this.sql.exec(chatWatchedSql, []).length > 0) {
      this.chat = this.openChatSource(state.platform)
    }
    this.chat?.close()
    this.sql.exec("UPDATE room_state SET chat_watched = 0 WHERE id = 1 AND chat_watched = 1", [])
    this.forgetWinnerChat()
  }

  private openChatSource(platform: string): ChatSource {
    return this.openChat(platform, {
      onMessage: (message) => this.guarded("chat-message", () => this.onChatMessage(message)),
      onChannelEntry: (event) =>
        this.guarded("channel-entry", () => this.requestChannelEntry(event)),
      onChannelEntryUnavailable: (cause) =>
        this.guarded("channel-entry-unavailable", () => this.channelEntryUnavailable(cause)),
      topics: () => this.watchTopics(),
      onUnavailable: (cause) => this.guarded("chat-unavailable", () => this.chatUnavailable(cause)),
      onSchedule: () => this.guarded("alarm", () => this.rearm()),
    })
  }

  // The keyword while entries are open to it, otherwise the winners whose pick is not rerolled: the only
  // ones whose messages the room shows or claims with.
  private chatAudience(state: RoomState): ChatAudience {
    const keyword = this.channelEntrySettings?.keyword ?? null
    if (keyword !== null) return { kind: "keyword", keyword }
    const rows = this.sql.exec(watchedChattersSql, [state.platform])
    return {
      kind: "chatters",
      userIds: rows.map((row) => new RowReader("draws", row).text("platform_user_id")),
    }
  }

  /**
   * A chat message a platform's webhook brought, read like one the room's chat source delivers while the
   * chat watch runs, and dropped otherwise.
   */
  receiveChat(message: ChatMessage): void {
    this.guarded("chat", () => this.syncChat())
    if (this.chat === null || !this.chatWatchOpen(this.readState())) return
    this.guarded("chat-message", () => this.onChatMessage(message))
  }

  /**
   * The subscriptions and channel point redemptions one platform webhook brought, read like those the
   * room's chat source delivers while the chat watch runs, and dropped otherwise.
   */
  receiveChannelEntries(events: readonly ChannelEntryEvent[]): void {
    this.guarded("chat", () => this.syncChat())
    if (this.chat === null || !this.chatWatchOpen(this.readState())) return
    for (const event of events) {
      this.guarded("channel-entry", () => this.requestChannelEntry(event))
    }
  }

  private chatWatchOpen(state: RoomState): boolean {
    const takesEntries = state.status === "open" && takesChannelEntries(state.rules)
    return (takesEntries && !state.chatUnavailable) || this.winnerChatWatched(state)
  }

  // While entries are open, what the rules take; after the draw, only the winners' chat.
  private watchTopics(): WatchTopics {
    const settings = this.channelEntrySettings
    if (settings === null) return { chat: true, subscriptions: false, pointsRewardId: null }
    return {
      chat: settings.keyword !== null,
      subscriptions: settings.subEntry,
      pointsRewardId: settings.pointsRewardId,
    }
  }

  private winnerChatWatched(state: RoomState): boolean {
    return state.status === "drawn" && !state.chatUnavailable && !this.chatWatchOver()
  }

  private chatWatchOver(): boolean {
    const end = this.standingWindowEnd()
    return end === null || this.clock.now() > end
  }

  private dropChatOf(chatterUserId: string | undefined): void {
    this.winnerChat = this.winnerChat.filter((entry) => entry.chatterUserId !== chatterUserId)
  }

  private forgetWinnerChat(): void {
    if (this.winnerChat.length === 0) return
    this.winnerChat = []
    this.pushLive()
  }

  /** The end of the soonest claim time among winners who may still claim, `null` when none waits. */
  private nextClaimDeadline(): Instant | null {
    const row = this.sql.exec(nextClaimDeadlineSql, [this.clock.now()])[0]
    return row === undefined ? null : new RowReader("draws", row).nullableInt("deadline")
  }

  // While entries are open, the entry keyword queues the chatter. After the draw, a message from a winner
  // whose pick is not rerolled goes to the live page from memory only; one from the winner who may still
  // claim also claims. Every other message is dropped here, unread and unlogged.
  private onChatMessage(message: ChatMessage): void {
    // An open room has no picks, so the winner paths below would find nothing.
    if (this.channelEntrySettings !== null) {
      this.requestChatEntry(this.channelEntrySettings, message)
      return
    }
    const shown = this.showWinnerChat(message)
    const claimed = this.claimFromChat(message)
    if (shown && !claimed) {
      this.pushLive()
      // A throttled push only sets `pushDueAt`; the alarm has to wake the room for it.
      if (this.pushDueAt !== null) this.guarded("alarm", () => this.rearm())
    }
  }

  // Only the chatter's name and badges are kept, never the text. A repeat keeps the first request, an entrant and the broadcaster are not queued.
  private requestChatEntry(settings: ChannelEntrySettings, message: ChatMessage): void {
    if (settings.keyword === null || !isEntryMessage(message.text, settings.keyword)) return
    this.queueEntryRequest(settings, message, "chat", message.roles)
  }

  // A sub enters with the tier of its event, a redemption only of the chosen reward; neither carries VIP or moderator badges, the stored role lists still count.
  private requestChannelEntry(event: ChannelEntryEvent): void {
    const settings = this.channelEntrySettings
    if (settings === null) return
    switch (event.via) {
      case "sub":
        if (!settings.subEntry) return
        this.queueEntryRequest(settings, event.viewer, "sub", {
          subTier: event.subTier,
          isVip: false,
          isModerator: false,
        })
        return
      case "points":
        if (event.rewardId !== settings.pointsRewardId) return
        this.queueEntryRequest(settings, event.viewer, "points", {
          subTier: null,
          isVip: false,
          isModerator: false,
        })
        return
    }
  }

  private queueEntryRequest(
    settings: ChannelEntrySettings,
    viewer: ChannelViewer,
    via: ChatRequest["via"],
    roles: ChatterRoles,
  ): void {
    const now = this.clock.now()
    if (settings.closesAt !== null && now >= settings.closesAt) return
    if (viewer.platformUserId === settings.broadcasterId) return
    if (this.sql.exec(entryOfSql, [settings.platform, viewer.platformUserId]).length > 0) return
    const queued = this.sql.exec(insertChatEntryRequestSql, [
      viewer.platformUserId,
      viewer.login,
      viewer.displayName,
      roles.subTier,
      roles.isVip ? 1 : 0,
      roles.isModerator ? 1 : 0,
      now,
      via,
    ])
    if (queued.length > 0) this.guarded("alarm", () => this.rearm())
  }

  private showWinnerChat(message: ChatMessage): boolean {
    const row = this.sql.exec(winnerChatNameSql, [message.platformUserId])[0]
    if (row === undefined) return false
    this.winnerChatSeq += 1
    const line: WinnerChatLine = {
      id: this.winnerChatSeq,
      name: new RowReader("entries", row).text("display_name"),
      text: message.text,
      at: this.clock.now(),
    }
    this.winnerChat = [...this.winnerChat, { chatterUserId: message.platformUserId, line }].slice(
      -this.config.liveWinnerChatMax,
    )
    return true
  }

  private claimFromChat(message: ChatMessage): boolean {
    const pick = this.sql.exec(waitingPickOfChatterSql, [
      message.platformUserId,
      this.clock.now(),
    ])[0]
    if (pick === undefined) return false
    const state = this.readState()
    const { claimKeyword } = state.rules
    if (
      claimKeyword !== null
      && !message.text.toLowerCase().includes(claimKeyword.trim().toLowerCase())
    ) {
      return false
    }
    const outcome = this.claim(
      new RowReader("draws", pick).int("n"),
      { platform: state.platform, platformUserId: message.platformUserId },
      "chat",
      null,
    )
    return outcome.kind === "claimed"
  }

  // The watcher has already closed; the flag keeps the room from opening it again until a reroll.
  // A later connection asks for chat only (see `syncChat`), so the refusal is not repeated at every reconnect.
  private channelEntryUnavailable(cause: unknown): void {
    this.sql.exec("UPDATE room_state SET channel_entry_unavailable = 1 WHERE id = 1", [])
    this.recordFailure("eventsub", cause)
  }

  private chatUnavailable(cause: unknown): void {
    this.sql.exec("UPDATE room_state SET chat_unavailable = 1 WHERE id = 1", [])
    this.guarded("viewer-push", () => this.pushViewers())
    this.recordFailure("eventsub", cause)
  }

  private pushLive(): void {
    const now = this.clock.now()
    if (this.lastPushAt !== null && now - this.lastPushAt < this.config.liveIntervalMs) {
      this.pushDueAt = this.lastPushAt + this.config.liveIntervalMs
      return
    }
    this.lastPushAt = now
    this.pushDueAt = null
    const snapshot = this.liveSnapshot()
    const entrantsAfter = this.entrantsDelta()
    const push: LivePush = { ...snapshot, entrantsAfter }
    const overlayPush: OverlayPush = { ...overlaySnapshot(snapshot), entrantsAfter }
    this.live.broadcast(JSON.stringify(push))
    this.live.broadcastOverlay(JSON.stringify(overlayPush))
    this.lastPushedSeq = this.headSeq()
  }

  // Entries change nothing a viewer's page shows, so an unchanged outcome sends nothing.
  private pushViewers(): void {
    const outcome = this.viewerOutcome(this.readState())
    const key = JSON.stringify(outcome)
    if (key === this.lastViewerOutcome) return
    this.lastViewerOutcome = key
    const push: ViewerPush = { ...outcome, now: this.clock.now() }
    this.live.broadcastViewers(JSON.stringify(push))
  }

  private viewerOutcome(state: RoomState): ViewerOutcome {
    const now = this.clock.now()
    return {
      status: state.status,
      finished: this.isFinished(state),
      chatClaimAvailable: !state.chatUnavailable,
      winners: this.readDraws().map((draw) => ({
        n: draw.n,
        platformUserId: draw.platformUserId,
        claimUntil: draw.claimUntil,
        claim: winnerClaim(draw, now),
      })),
    }
  }

  // A pick that is waiting can still claim; an expired one can still be rerolled while an undrawn
  // entrant exists and the reroll window after the last claim deadline is open.
  private isFinished(state: RoomState): boolean {
    if (state.status !== "drawn") return false
    const last = this.lastClaimDeadline()
    if (last === null) return true
    if (this.clock.now() <= last) return false
    return this.rerollWindowOver() || !this.hasUndrawnEntrant()
  }

  /** The latest claim deadline among picks that are neither claimed nor rerolled, `null` when none is left. */
  private lastClaimDeadline(): Instant | null {
    const row = this.sql.exec(lastClaimDeadlineSql, [])[0]
    return row === undefined ? null : new RowReader("draws", row).nullableInt("deadline")
  }

  private hasUndrawnEntrant(): boolean {
    return this.sql.exec(undrawnEntrantSql, []).length > 0
  }

  // Counted from the latest deadline of every pick still standing, claimed ones too, so a claim never
  // pulls the end of the window back; `null` while no unclaimed pick is left to reroll.
  private rerollWindowEnd(): Instant | null {
    return this.lastClaimDeadline() === null ? null : this.standingWindowEnd()
  }

  // The reroll window after the latest deadline of any pick that is not rerolled; `null` without one.
  private standingWindowEnd(): Instant | null {
    const row = this.sql.exec(lastStandingDeadlineSql, [])[0]
    const last = row === undefined ? null : new RowReader("draws", row).nullableInt("deadline")
    return last === null ? null : last + this.config.rerollWindowSeconds * 1000
  }

  private rerollWindowOver(): boolean {
    const end = this.rerollWindowEnd()
    return end !== null && this.clock.now() > end
  }

  private rerollState(state: RoomState): RerollState {
    const end = this.rerollWindowEnd()
    if (state.status !== "drawn" || end === null) return { rerollOpen: false, rerollBlocked: null }
    if (this.clock.now() > end) return { rerollOpen: false, rerollBlocked: "window-over" }
    if (!this.hasUndrawnEntrant()) return { rerollOpen: false, rerollBlocked: "nobody-left" }
    return { rerollOpen: true, rerollBlocked: null }
  }

  private entrantsDelta(): EntrantsDelta {
    const head = this.headSeq()
    const fromSeq = this.lastPushedSeq ?? head
    const max = this.config.liveEntrantsPerPush
    const rows = head > fromSeq ? this.entrants({ afterSeq: fromSeq, limit: max + 1 }) : []
    return { fromSeq, rows: rows.slice(0, max), truncated: rows.length > max }
  }

  private headSeq(): number {
    const row = this.sql.exec(headSeqSql, [])[0]
    return row === undefined ? 0 : (new RowReader("entries", row).nullableInt("head") ?? 0)
  }

  private rearm(): void {
    const state = this.readState()
    const open = state.status === "open"
    const claimDeadline = state.status === "drawn" ? this.nextClaimDeadline() : null
    const wakeups = [
      open ? state.closesAt : null,
      open ? state.rolesRefreshAt : null,
      this.pushDueAt,
      state.mirrorPending ? (this.mirrorRetryAt ?? this.clock.now()) : null,
      awaitsCommit(state) && !state.commitGaveUp
        ? this.commitWaitUntil(state, this.clock.now())
        : null,
      this.drawWake(state),
      // One past the inclusive deadline, so the alarm finds the claim time over and pushes the viewers.
      claimDeadline === null ? null : claimDeadline + 1,
      this.rerollWindowWake(state),
      this.chatWatchWake(state),
      this.chatEntrantsWake(state),
      this.retentionDeadline(state),
      this.answersDeadline(),
      this.chat?.wakeAt() ?? null,
      this.metricsWake(),
    ].filter((at): at is Instant => at !== null)
    if (wakeups.length === 0) this.alarm.clear()
    else this.alarm.set(Math.min(...wakeups))
  }

  // The end of the first minute that has an entry or a claim not yet reported, so each active minute is reported once, after it ends.
  private metricsWake(): Instant | null {
    const reported = this.metricsReportedUntil()
    const row = this.sql.exec(firstUnreportedActivitySql, [reported, reported])[0]
    const first = row === undefined ? null : new RowReader("entries", row).nullableInt("at")
    return first === null ? null : startOfMinute(first) + minuteMs
  }

  // The minutes that ended since the last report, read from the room's own rows so an object evicted in between loses none. Minutes older than the retention are not worth reporting.
  private takeFinishedMinutes(now: Instant): readonly MinuteCounts[] {
    const upTo = startOfMinute(now)
    const reported = this.metricsReportedUntil()
    const from = Math.max(reported, upTo - this.config.metricsRetentionHours * hourMs)
    if (from >= upTo) return []
    const byMinute = new Map<Instant, MinuteCounts>()
    for (const row of this.sql.exec(entriesPerMinuteSql, [from, upTo])) {
      const reader = new RowReader("entries", row)
      const minute = reader.int("minute")
      byMinute.set(minute, { minute, entries: reader.int("c"), claims: 0 })
    }
    for (const row of this.sql.exec(claimsPerMinuteSql, [from, upTo])) {
      const reader = new RowReader("draws", row)
      const minute = reader.int("minute")
      byMinute.set(minute, {
        minute,
        entries: byMinute.get(minute)?.entries ?? 0,
        claims: reader.int("c"),
      })
    }
    // With nothing to report the mark moves only past the retention: otherwise the next wake-up finds the same old rows again.
    if (byMinute.size > 0 || reported < from) {
      this.sql.exec("UPDATE room_state SET metrics_reported_until = ? WHERE id = 1", [upTo])
    }
    return [...byMinute.values()].toSorted((a, b) => a.minute - b.minute)
  }

  private metricsReportedUntil(): Instant {
    const row = this.sql.exec("SELECT metrics_reported_until FROM room_state WHERE id = 1", [])[0]
    return row === undefined ? 0 : new RowReader("room_state", row).int("metrics_reported_until")
  }

  private count(sql: string, params: readonly SqlValue[]): number {
    const row = this.sql.exec(sql, params)[0]
    return row === undefined ? 0 : new RowReader("room", row).int("c")
  }

  // One past the end of the reroll window, so the alarm finds the giveaway finished and pushes it.
  private rerollWindowWake(state: RoomState): Instant | null {
    if (state.status !== "drawn") return null
    const end = this.rerollWindowEnd()
    if (end === null || end < this.clock.now() || !this.hasUndrawnEntrant()) return null
    return end + 1
  }

  private chatEntrantsWake(state: RoomState): Instant | null {
    if (state.status !== "open" && !awaitsCommit(state)) return null
    if (this.sql.exec(chatEntryWaitingSql, []).length === 0) return null
    return this.chatCheckAt ?? this.clock.now()
  }

  // One past the end of the watch, so the alarm finds it over and closes the chat watch.
  private chatWatchWake(state: RoomState): Instant | null {
    if (state.status !== "drawn") return null
    const end = this.standingWindowEnd()
    return end === null || end < this.clock.now() ? null : end + 1
  }

  private guarded(effect: string, run: () => void): void {
    try {
      run()
    } catch (error) {
      console.warn("room effect failed", { giveawayId: this.giveawayIdOrNull(), effect, error })
    }
  }

  private giveawayIdOrNull(): string | null {
    const row = this.sql.exec("SELECT giveaway_id FROM room_state WHERE id = 1", [])[0]
    return row === undefined ? null : new RowReader("room_state", row).text("giveaway_id")
  }
}

// A winner's chat line with whom it came from, so a reroll can drop that chatter's lines.
interface ChatterLine {
  readonly chatterUserId: string
  readonly line: WinnerChatLine
}

// The roles a chat badge can show beyond the stored role lists.
type ChatRoleBadges = Pick<ChatterRoles, "isVip" | "isModerator">

// How an entry is written: its `via` and the roles the chat badges add to the stored lists.
interface EntryWay {
  readonly via: EntryVia
  readonly roles: ChatRoleBadges
}

const pageEntry: EntryWay = { via: "page", roles: { isVip: false, isModerator: false } }

function chatEntry(request: ChatRequest): EntryWay {
  return { via: request.via, roles: request.roles }
}

interface ChannelEntrySettings {
  readonly keyword: string | null
  readonly subEntry: boolean
  readonly pointsRewardId: string | null
  readonly platform: string
  readonly broadcasterId: string
  readonly closesAt: Instant | null
}

// What a chatter enters with when the check never ran for them.
const uncheckedChatter: Omit<CheckedChatter, "platformUserId"> = {
  isFollower: false,
  accountAgeDays: null,
  profileImageUrl: null,
  subTier: null,
}

// Twitch reads 100 profiles in one call, so one check reads every profile it needs in one request.
const chatEntrantsPerCheck = 100

// The last profile read after the close takes 30 profile calls, well inside the 45 subrequests of a Cloudflare Free invocation; whoever is beyond enters unchecked at the commit.
const chatEntrantsPerLastRead = chatEntrantsPerCheck * 30

// The last read's tier calls (100 ids each) on top of its 30 profile calls: 10 more stay inside the same 45.
// A redeemer beyond it enters with an unknown tier, as not subscribed.
const tierChecksPerLastRead = chatEntrantsPerCheck * 10

// A round is published at its time; the alarm waits this long more so the first try finds it.
const drawLagMs = 500

// What a removed winner is called from then on, in every language; the privacy page quotes the word.
const removedName = "removed"

// A new pick, a reroll, a claim or a delivery changes the counts the account store mirrors.
const markMirrorPendingSql = "UPDATE room_state SET mirror_pending = 1 WHERE id = 1"

// 128 bits, enough that a published leaf cannot be matched to an id by trying ids.
const saltBytes = 16

// A chunk of 1000 leaves is 40 KB, far inside the 2 MB value limit of a Durable Object, and a giveaway
// of 12,000 entrants writes 12 rows (spec Load budget) instead of one per entrant.
const leavesPerChunk = 1000
const hashBytes = 32
const ticketBytes = 8
const leafRecordBytes = hashBytes + ticketBytes

const roleColumns = ["platform", "platform_user_id", "role", "fetched_at"] as const
const exclusionColumns = ["platform", "platform_user_id", "reason"] as const
const exclusions: readonly Exclusion[] = ["blocked", "recent-winner"]

const failureColumns = {
  "role-refresh": "role_refresh_failures",
  eventsub: "eventsub_failures",
} as const satisfies Record<FailureKind, string>

/** Drops the winner chat from a snapshot, for audiences that must not see viewers' messages. */
export function overlaySnapshot({
  winnerChat: _winnerChat,
  winnerChatOpen: _winnerChatOpen,
  picksLeft: _picksLeft,
  actors: _actors,
  ...rest
}: LiveSnapshot): OverlaySnapshot {
  return rest
}

function summarize(state: RoomState): RoomSummary {
  return {
    status: state.status,
    closesAt: state.closesAt,
    entrantCount: state.entrantCount,
    ticketTotal: state.ticketTotal,
    winnerCount: state.winnerCount,
    chatClaimUnavailable: state.chatUnavailable,
    chatEntryOff:
      state.status === "open" && state.rules.chatKeyword !== null && state.chatUnavailable,
    channelEntryOff:
      state.status === "open"
      && (state.rules.subEntry || state.rules.pointsReward !== null)
      && (state.chatUnavailable || state.channelEntryUnavailable),
  }
}

// Entries the watch of the channel brings: the chat keyword, subs or a channel point reward.
function takesChannelEntries(rules: GiveawayRules): boolean {
  return rules.chatKeyword !== null || rules.subEntry || rules.pointsReward !== null
}

// Open, and its end time, if any, not reached yet: the alarm that closes the room may still be on its way.
function entriesOpen(state: RoomState, now: Instant): boolean {
  return state.status === "open" && (state.closesAt === null || now < state.closesAt)
}

function chatViewer(
  request: ChatRequest,
  checked: Omit<CheckedChatter, "platformUserId">,
): RoomViewer {
  return {
    platformUserId: request.platformUserId,
    login: request.login,
    displayName: request.displayName,
    profileImageUrl: checked.profileImageUrl,
    isFollower: checked.isFollower,
    subTier: checked.subTier ?? request.roles.subTier,
    accountAgeDays: checked.accountAgeDays,
  }
}

// What the room lacks to check an entry against `expected`: the excluded accounts, or the block list version the caller knows of.
function exclusionsMissing(state: RoomState, expected: EntryExpectation): ExclusionsMissing | null {
  if (!state.exclusionsLoaded) return "exclusions"
  return state.blockListVersion < expected.blockListVersion ? "block-list" : null
}

// Closed, with nothing committed yet. A room drawn before commitments existed never commits, and one whose
// entries the retention alarm deleted has nothing left to commit to.
function awaitsCommit(state: RoomState): boolean {
  return state.status === "closed" && state.commitment === null && !state.entriesDeleted
}

function encodeLeaves(leaves: readonly Leaf[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(leaves.length * leafRecordBytes)
  const view = new DataView(bytes.buffer)
  for (const [index, leaf] of leaves.entries()) {
    bytes.set(leaf.hash, index * leafRecordBytes)
    view.setBigUint64(index * leafRecordBytes + hashBytes, BigInt(leaf.tickets))
  }
  return bytes
}

function decodeLeaves(data: Uint8Array<ArrayBuffer>): Leaf[] {
  if (data.length % leafRecordBytes !== 0) throw new RoomRowError("leaves", "data")
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return Array.from({ length: data.length / leafRecordBytes }, (_, index) => {
    const at = index * leafRecordBytes
    const tickets = Number(view.getBigUint64(at + hashBytes))
    if (!Number.isSafeInteger(tickets)) throw new RoomRowError("leaves", "data")
    return { hash: data.slice(at, at + hashBytes), tickets }
  })
}

function drawRefusal(state: RoomState): DrawOutcome | null {
  switch (state.status) {
    case "open":
      return { kind: "not-closed" }
    case "closed":
    case "drawn":
      return state.entriesDeleted ? { kind: "entries-deleted" } : null
  }
}

function nextPickNumber(draws: readonly DrawRow[]): number {
  return draws.reduce((highest, draw) => Math.max(highest, draw.n), -1) + 1
}

function rerollRefusal(target: DrawRow | null): RerollOutcome | null {
  if (target === null) return { kind: "unknown-pick" }
  if (target.rerolled) return { kind: "already-rerolled" }
  if (target.claim.state === "claimed") return { kind: "already-claimed" }
  return null
}

function claimRefusal(draw: DrawRow | null, winner: Identity): ClaimOutcome {
  if (
    draw === null
    || draw.platform !== winner.platform
    || draw.platformUserId !== winner.platformUserId
  ) {
    return { kind: "not-a-winner" }
  }
  if (draw.claim.state === "claimed") return { kind: "already-claimed" }
  if (draw.rerolled) return { kind: "rerolled" }
  return { kind: "expired" }
}

function answersRefusal(
  draw: DrawRow | null,
  winner: Identity,
  now: Instant,
  retentionMs: number,
): SaveAnswersOutcome {
  if (
    draw === null
    || draw.platform !== winner.platform
    || draw.platformUserId !== winner.platformUserId
  ) {
    return { kind: "not-a-winner" }
  }
  switch (pickAnswers(draw, now, retentionMs)) {
    case "sent":
      return { kind: "already-answered" }
    case "closed":
      return { kind: "form-closed" }
    // A claimed pick in this state would have been saved.
    case "open":
      return { kind: "not-claimed" }
  }
}

function pickAnswers(draw: DrawRow, now: Instant, retentionMs: number): PickAnswers {
  if (draw.answeredAt !== null) return "sent"
  if (draw.deliveredAt !== null || draw.rerolled) return "closed"
  if (draw.claim.state === "claimed") return now < draw.claim.at + retentionMs ? "open" : "closed"
  return now > draw.claimUntil ? "closed" : "open"
}

function liveWinner(row: SqlRow, now: Instant): LiveWinner {
  const draw = parseDraw(row)
  return {
    n: draw.n,
    entrySeq: new RowReader("entries", row).nullableInt("seq"),
    displayName: new RowReader("draws", row).nullableText("display_name"),
    profileImageUrl: new RowReader("entries", row).nullableText("profile_image_url"),
    claimUntil: draw.claimUntil,
    claim: winnerClaim(draw, now),
  }
}

function pickActors(row: SqlRow): PickActors {
  const { n, drawnBy, rerolledBy, claimMarkedBy } = parseDraw(row)
  return { n, drawnBy, rerolledBy, claimMarkedBy }
}

function winnerClaim(draw: DrawRow, now: Instant): WinnerClaim {
  if (draw.claim.state === "claimed") {
    return { state: "claimed", at: draw.claim.at, via: draw.claim.via }
  }
  if (draw.rerolled) return { state: "rerolled" }
  return { state: now > draw.claimUntil ? "expired" : "waiting" }
}
