import type { ResolvedConfig } from "../config.ts"
import {
  evaluateEligibility,
  type GiveawayRules,
  type IneligibleReason,
  type ViewerFacts,
} from "../domain/rules.ts"
import {
  drawWinners,
  pickWinner,
  sortEntries,
  type DrawEntry,
  type Identity,
  type Winner,
} from "../lib/draw.ts"
import { drandChain, roundAtOrAfter, roundTime } from "../lib/drand.ts"
import { leafHash, merkleRoot, type LeafPreimage } from "../lib/merkle.ts"
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
import {
  ChatWatcher,
  type ChatLink,
  type ChatMessage,
  type ChatWatcherConfig,
} from "./chat-watcher.ts"
import {
  entrantsAfterSql,
  entryOfSql,
  headSeqSql,
  lastNamesSql,
  nextClaimDeadlineSql,
  lastClaimDeadlineSql,
  lastStandingDeadlineSql,
  undrawnEntrantSql,
  recentEntriesCountSql,
  retainedDataSql,
  waitingPickOfChatterSql,
  winnerChatNameSql,
} from "./queries.ts"
import {
  parseDraw,
  parseEntrant,
  parseEntry,
  parseState,
  RoomRowError,
  RowReader,
  type ClaimedVia,
  type Commitment,
  type DrawRow,
  type Entrant,
  type EntrySummary,
  type RoomState,
  type RoomStatus,
} from "./rows.ts"

export type RoomConfig = Pick<
  ResolvedConfig,
  | "claimKeywordMaxLength"
  | "ticketsPerGroupMax"
  | "roleRefreshSeconds"
  | "liveIntervalMs"
  | "liveLastNames"
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
  | "drandPublishMarginSeconds"
>
  & ChatWatcherConfig

export interface RoomDeps {
  readonly sql: SyncSql
  readonly alarm: Alarm
  readonly live: LiveHub
  readonly clock: Clock
  readonly random: Random
  readonly config: RoomConfig
  /** How this target reaches Twitch chat while the room watches its winners. */
  readonly chat: ChatLink
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
  /** How many winners the draw picks. */
  readonly winnerCount: number
}

/** A viewer entering: who they are on the giveaway's platform and what the platform said about them. */
export type RoomViewer = Omit<ViewerFacts, "userId" | "isVip" | "isModerator"> & {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
}

export type EnterOutcome =
  | { readonly kind: "entered"; readonly entry: EntrySummary }
  | { readonly kind: "already-in"; readonly entry: EntrySummary }
  | { readonly kind: "not-eligible"; readonly reason: IneligibleReason }
  | { readonly kind: "closed" }

export type CloseOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "not-open"; readonly status: RoomStatus }

export type SetWinnerCountOutcome =
  | { readonly kind: "set" }
  | { readonly kind: "not-open"; readonly status: RoomStatus }

export type DrawOutcome =
  | { readonly kind: "drawn"; readonly winners: readonly Winner[] }
  /** The committed drand round is not published yet; nothing was drawn and a later call may draw. */
  | { readonly kind: "round-pending"; readonly availableAt: Instant }
  /** The beacon failed after its retries; nothing was drawn and a later call may draw. */
  | { readonly kind: "beacon-unavailable" }
  | { readonly kind: "not-closed" }
  | { readonly kind: "already-drawn" }
  | { readonly kind: "entries-deleted" }

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

/** What the caller of {@link GiveawayRoom.onAlarm} still has to do, because it needs a port the room lacks. */
export interface AlarmDuties {
  /** Fetch the VIP and moderator lists, then call `replaceRoles` or `recordFailure`. */
  readonly refreshRoles: boolean
  /** Mirror this status to the account store, then call `markMirrored`. Null when nothing is pending. */
  readonly mirrorStatus: RoomStatus | null
  /** Call `commit`: the room is closed and has no commitment yet. */
  readonly commit: boolean
}

export type FailureKind = "role-refresh" | "eventsub"

export interface RoomSummary {
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly entrantCount: number
  readonly ticketTotal: number
  /** How many winners the draw picks. */
  readonly winnerCount: number
  /** No chat claim is possible: the chat watch gave up, so a winner can only claim on the page or by the streamer's hand. */
  readonly chatClaimUnavailable: boolean
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
  /** Null when the entry is gone. */
  readonly displayName: string | null
  readonly claimUntil: Instant
  readonly claim: WinnerClaim
}

/** A pick with who it went to. */
export interface WinnerPick extends LiveWinner, Identity {}

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
  }

/** The streamer's live page snapshot: the overlay's plus the winners' chat. */
export type LiveSnapshot = OverlaySnapshot & {
  /** The newest chat messages of winners, newest last; kept in room memory only. */
  readonly winnerChat: readonly WinnerChatLine[]
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
  private readonly chat: ChatWatcher
  private lastPushAt: Instant | null = null
  // Lost with the object; the first push after that carries no rows and the page fetches the gap.
  private lastPushedSeq: number | null = null
  private pushDueAt: Instant | null = null
  // Lost with the object; the first outcome after that is pushed again.
  private lastViewerOutcome: string | null = null
  private mirrorRetryAt: Instant | null = null
  // Lost with the object; the first alarm after that commits at once.
  private commitRetryAt: Instant | null = null
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
    this.chat = new ChatWatcher({
      ...deps.chat,
      clock: deps.clock,
      config: deps.config,
      onMessage: (message) => this.guarded("chat-message", () => this.onChatMessage(message)),
      onUnavailable: (cause) => this.guarded("chat-unavailable", () => this.chatUnavailable(cause)),
      onSchedule: () => this.guarded("alarm", () => this.rearm()),
    })
  }

  /** Creates the room once; a second call with any giveaway changes nothing. */
  init(giveaway: GiveawayInit): void {
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
  }

  /** Changes how many winners the draw picks, while entries are open only: once the room closed the count is part of what was committed. */
  setWinnerCount(count: number): SetWinnerCountOutcome {
    const changed = this.sql.exec(
      "UPDATE room_state SET winner_count = ? WHERE id = 1 AND status = 'open' RETURNING id",
      [count],
    )
    if (changed.length === 0) return { kind: "not-open", status: this.readState().status }
    this.afterWrite()
    return { kind: "set" }
  }

  /** One entry per account: a repeat returns the first entry and changes nothing. */
  enter(viewer: RoomViewer): EnterOutcome {
    const now = this.clock.now()
    const outcome = this.sql.transaction((): EnterOutcome => {
      const state = this.readState()
      if (state.status !== "open" || (state.closesAt !== null && now >= state.closesAt)) {
        return { kind: "closed" }
      }
      const existing = this.sql.exec(entryOfSql, [state.platform, viewer.platformUserId])[0]
      if (existing !== undefined) return { kind: "already-in", entry: parseEntry(existing) }

      const eligibility = evaluateEligibility(
        state.rules,
        this.viewerFacts(state, viewer),
        state.broadcasterId,
      )
      if (!eligibility.eligible) return { kind: "not-eligible", reason: eligibility.reason }

      // `entrant_count` only grows and moves in the same transaction, so the next `seq` never repeats.
      this.sql.exec(
        `INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at, salt)
         VALUES ((SELECT entrant_count + 1 FROM room_state WHERE id = 1), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.platform,
          viewer.platformUserId,
          viewer.login,
          viewer.displayName,
          eligibility.group,
          eligibility.tickets,
          now,
          this.random.bytes(saltBytes),
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
    })
    if (outcome.kind === "entered") this.afterWrite()
    return outcome
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
  close(): CloseOutcome {
    if (!this.closeOpenRoom()) return { kind: "not-open", status: this.readState().status }
    this.mirrorRetryAt = this.clock.now() + this.config.mirrorRetrySeconds * 1000
    this.afterOutcomeWrite()
    return { kind: "closed" }
  }

  /** Arms the alarm from the stored state; a room that was never initialised arms nothing. */
  armAlarm(): void {
    if (this.sql.exec("SELECT 1 FROM room_state WHERE id = 1", []).length === 0) return
    this.guarded("alarm", () => this.rearm())
  }

  /** Runs when the alarm fires: closes at the end time, pushes a held live update, reports what is left to the caller. */
  onAlarm(): AlarmDuties {
    const now = this.clock.now()
    let state = this.readState()
    let pushNow = this.pushDueAt !== null && now >= this.pushDueAt
    if (state.status === "open" && state.closesAt !== null && now >= state.closesAt) {
      pushNow = this.closeOpenRoom() || pushNow
      state = this.readState()
    }
    pushNow = (state.status === "drawn" && this.rerollWindowOver()) || pushNow
    pushNow = this.deleteExpiredEntries(state, now) || pushNow
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
    if (mirrorDue) this.mirrorRetryAt = now + this.config.mirrorRetrySeconds * 1000
    const commitDue = awaitsCommit(state) && now >= (this.commitRetryAt ?? now)
    if (commitDue) this.commitRetryAt = now + this.config.commitRetrySeconds * 1000
    this.guarded("chat", () => {
      this.syncChat()
      this.chat.onAlarm()
    })
    this.guarded("alarm", () => this.rearm())
    return { refreshRoles, mirrorStatus: mirrorDue ? state.status : null, commit: commitDue }
  }

  /** Clears the pending mirror once `status` reached the account store; a newer status stays pending. */
  markMirrored(status: RoomStatus): void {
    this.sql.exec("UPDATE room_state SET mirror_pending = 0 WHERE id = 1 AND status = ?", [status])
    this.guarded("alarm", () => this.rearm())
  }

  /**
   * Commits a closed room to its entrants and to a drand round: salts every entry that has none (one
   * written before salts existed), then stores the Merkle root over the sorted leaves, the round and the
   * leaf list. Leaves an open, a committed and a drawn room alone; two calls at once commit once.
   */
  async commit(): Promise<void> {
    if (!awaitsCommit(this.readState())) return
    const entries = this.saltedEntries()
    const leaves = await Promise.all(
      entries.map(async (entry) => ({ hash: await leafHash(entry), tickets: entry.tickets })),
    )
    const root = await merkleRoot(leaves)
    const chain = drandChain(this.config)
    const now = this.clock.now()
    const round = roundAtOrAfter(chain, now + this.config.drandLeadSeconds * 1000)
    this.sql.transaction(() => {
      const stored = this.sql.exec(
        `UPDATE room_state SET merkle_root = ?, drand_round = ?, committed_at = ?, drand_chain_hash = ?,
           drand_genesis_seconds = ?, drand_period_seconds = ?
         WHERE id = 1 AND status = 'closed' AND merkle_root IS NULL RETURNING id`,
        [root, round, now, chain.chainHash, chain.genesisSeconds, chain.periodSeconds],
      )
      if (stored.length === 0) return
      for (let from = 0; from < leaves.length; from += leavesPerChunk) {
        this.sql.exec("INSERT INTO leaves (chunk, data) VALUES (?, ?)", [
          from / leavesPerChunk,
          encodeLeaves(leaves.slice(from, from + leavesPerChunk)),
        ])
      }
    })
    this.guarded("alarm", () => this.rearm())
  }

  /**
   * Picks `count` winners from a closed room, once, with the randomness of the drand round the room
   * committed to. While that round is missing it draws nothing and uses no other randomness.
   */
  async draw(): Promise<DrawOutcome> {
    const early = drawRefusal(this.readState())
    if (early !== null) return early
    await this.commit()
    const state = this.readState()
    const refusal = drawRefusal(state)
    if (refusal !== null) return refusal
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
        return { kind: "round-pending", availableAt }
      }
      case "unavailable":
        return { kind: "beacon-unavailable" }
      case "round":
        break
    }
    const seed = answer.round.randomness
    const winners = await drawWinners(seed, this.readDrawEntries(), state.winnerCount)
    const now = this.clock.now()
    const outcome = this.sql.transaction((): DrawOutcome => {
      const flipped = this.sql.exec(
        "UPDATE room_state SET status = 'drawn', seed = ?, mirror_pending = 1 WHERE id = 1 AND status = 'closed' AND entries_deleted = 0 RETURNING id",
        [seed],
      )
      if (flipped.length === 0) return drawRefusal(this.readState()) ?? { kind: "not-closed" }
      for (const winner of winners) this.insertPick(winner, now, state.claimSeconds)
      return { kind: "drawn", winners }
    })
    if (outcome.kind === "drawn") {
      this.mirrorRetryAt = now + this.config.mirrorRetrySeconds * 1000
      this.afterOutcomeWrite()
    }
    return outcome
  }

  /** Marks pick `n` rerolled and adds the next pick; a repeat for the same `n` changes nothing. */
  async reroll(n: number): Promise<RerollOutcome> {
    const state = this.readState()
    if (state.status !== "drawn") return { kind: "not-drawn" }
    if (state.entriesDeleted) return { kind: "entries-deleted" }
    const draws = this.readDraws()
    const refusal = rerollRefusal(draws.find((draw) => draw.n === n) ?? null)
    if (refusal !== null) return refusal
    if (this.rerollWindowOver()) return { kind: "reroll-window-over" }

    const next = draws.reduce((highest, draw) => Math.max(highest, draw.n), -1) + 1
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
        "UPDATE draws SET rerolled = 1 WHERE n = ? AND rerolled = 0 AND claimed_at IS NULL RETURNING n",
        [n],
      )
      if (marked.length === 0) return rerollRefusal(this.readDraw(n)) ?? { kind: "unknown-pick" }
      this.insertPick(winner, now, state.claimSeconds)
      // A new waiting winner gets a fresh chat watch even when the last one gave up.
      this.sql.exec("UPDATE room_state SET chat_unavailable = 0 WHERE id = 1", [])
      return { kind: "rerolled", replaced: n, winner }
    })
    if (outcome.kind === "rerolled") {
      this.dropChatOf(draws.find((draw) => draw.n === n)?.platformUserId)
      this.afterOutcomeWrite()
    }
    return outcome
  }

  /** Records that the winner of pick `n` claimed in time; the first claim wins, a later one is refused. */
  claim(n: number, winner: Identity, via: ClaimedVia): ClaimOutcome {
    const now = this.clock.now()
    const claimed = this.sql.exec(
      `UPDATE draws SET claimed_at = ?, claimed_via = ?
       WHERE n = ? AND platform = ? AND platform_user_id = ?
         AND claimed_at IS NULL AND rerolled = 0 AND claim_until >= ?
       RETURNING n`,
      [now, via, n, winner.platform, winner.platformUserId, now],
    )
    if (claimed.length === 1) {
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
    const tuple = `(${roleColumns.map(() => "?").join(", ")})`
    this.sql.transaction(() => {
      this.sql.exec("DELETE FROM channel_roles", [])
      for (let from = 0; from < rows.length; from += rolesPerInsert) {
        const chunk = rows.slice(from, from + rolesPerInsert)
        this.sql.exec(
          `INSERT INTO channel_roles (${roleColumns.join(", ")}) VALUES ${chunk.map(() => tuple).join(", ")}`,
          chunk.flat(),
        )
      }
      this.sql.exec("UPDATE room_state SET roles_refresh_at = ? WHERE id = 1", [
        now + this.config.roleRefreshSeconds * 1000,
      ])
    })
    this.guarded("alarm", () => this.rearm())
  }

  /** Closes the chat watch and nothing else, for the host that is shutting the room down. */
  closeChat(): void {
    this.chat.close()
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
      return {
        ...liveWinner(row, now),
        platform: draw.platform,
        platformUserId: draw.platformUserId,
      }
    })
  }

  liveSnapshot(): LiveSnapshot {
    const state = this.readState()
    const now = this.clock.now()
    const windowSeconds = this.config.liveRateWindowSeconds
    const recent = this.sql.exec(recentEntriesCountSql, [now - windowSeconds * 1000])[0]
    const lastNames = this.sql
      .exec(lastNamesSql, [this.config.liveLastNames])
      .map((row) => new RowReader("entries", row).text("display_name"))
    const winners = this.readPickRows().map((row) => liveWinner(row, now))
    return {
      ...summarize(state),
      title: state.title,
      code: state.code,
      entriesPerSecond:
        recent === undefined ? 0 : new RowReader("entries", recent).int("c") / windowSeconds,
      lastNames,
      winners,
      winnerChat: this.winnerChat.map((entry) => entry.line),
      ...this.rerollState(state),
      roleRefreshFailures: state.roleRefreshFailures,
      eventSubFailures: state.eventSubFailures,
    }
  }

  private readState(): RoomState {
    const row = this.sql.exec("SELECT * FROM room_state WHERE id = 1", [])[0]
    if (row === undefined) throw new Error("room is not initialised")
    return parseState(row, this.config)
  }

  private readPickRows(): SqlRow[] {
    return this.sql.exec(
      `SELECT d.n, d.platform, d.platform_user_id, d.claim_until, d.claimed_at, d.claimed_via, d.rerolled, d.leaf_index, e.display_name, e.seq
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

  private viewerFacts(state: RoomState, viewer: RoomViewer): ViewerFacts {
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
      isVip: roles.includes("vip"),
      isModerator: roles.includes("moderator"),
      accountAgeDays: viewer.accountAgeDays,
    }
  }

  private insertPick(winner: Winner, now: Instant, claimSeconds: number): void {
    this.sql.exec(
      "INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until, leaf_index) VALUES (?, ?, ?, ?, ?, ?)",
      [
        winner.n,
        winner.platform,
        winner.platformUserId,
        now,
        now + claimSeconds * 1000,
        winner.leafIndex,
      ],
    )
  }

  private closeOpenRoom(): boolean {
    const closed = this.sql.exec(
      "UPDATE room_state SET status = 'closed', closed_at = ?, mirror_pending = 1 WHERE id = 1 AND status = 'open' RETURNING id",
      [this.clock.now()],
    )
    return closed.length > 0
  }

  // Counts, picks and claims stay: the winner list belongs to the giveaway, the entrants' data does not.
  private deleteExpiredEntries(state: RoomState, now: Instant): boolean {
    const deadline = this.retentionDeadline(state)
    if (deadline === null || now < deadline) return false
    this.sql.transaction(() => {
      this.sql.exec("DELETE FROM entries", [])
      this.sql.exec("DELETE FROM channel_roles", [])
      this.sql.exec("UPDATE room_state SET entries_deleted = 1 WHERE id = 1", [])
    })
    console.info("room entries deleted", {
      giveawayId: state.giveawayId,
      entrantCount: state.entrantCount,
    })
    return true
  }

  // Null while entries are open and once nothing is left to delete.
  private retentionDeadline(state: RoomState): Instant | null {
    if (state.closedAt === null || this.sql.exec(retainedDataSql, []).length === 0) return null
    return state.closedAt + this.config.entryRetentionSeconds * 1000
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

  // The watcher runs from the draw until the reroll window after the last pick's claim time ends, as
  // long as a pick is not rerolled and it did not give up for this giveaway. Closing forgets the messages.
  private syncChat(): void {
    const state = this.readState()
    const watching = state.status === "drawn" && !state.chatUnavailable && !this.chatWatchOver()
    if (watching) {
      this.chat.open()
      return
    }
    this.chat.close()
    this.forgetWinnerChat()
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

  // A message from a winner whose pick is not rerolled goes to the live page from memory only; one from
  // the winner who may still claim also claims. Every other message is dropped here, unread and unlogged.
  private onChatMessage(message: ChatMessage): void {
    const shown = this.showWinnerChat(message)
    const claimed = this.claimFromChat(message)
    if (shown && !claimed) {
      this.pushLive()
      // A throttled push only sets `pushDueAt`; the alarm has to wake the room for it.
      if (this.pushDueAt !== null) this.guarded("alarm", () => this.rearm())
    }
  }

  private showWinnerChat(message: ChatMessage): boolean {
    const row = this.sql.exec(winnerChatNameSql, [message.chatterUserId])[0]
    if (row === undefined) return false
    this.winnerChatSeq += 1
    const line: WinnerChatLine = {
      id: this.winnerChatSeq,
      name: new RowReader("entries", row).text("display_name"),
      text: message.text,
      at: this.clock.now(),
    }
    this.winnerChat = [...this.winnerChat, { chatterUserId: message.chatterUserId, line }].slice(
      -this.config.liveWinnerChatMax,
    )
    return true
  }

  private claimFromChat(message: ChatMessage): boolean {
    const pick = this.sql.exec(waitingPickOfChatterSql, [
      message.chatterUserId,
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
      { platform: state.platform, platformUserId: message.chatterUserId },
      "chat",
    )
    return outcome.kind === "claimed"
  }

  // The watcher has already closed; the flag keeps the room from opening it again until a reroll.
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
      awaitsCommit(state) ? (this.commitRetryAt ?? this.clock.now()) : null,
      // One past the inclusive deadline, so the alarm finds the claim time over and pushes the viewers.
      claimDeadline === null ? null : claimDeadline + 1,
      this.rerollWindowWake(state),
      this.chatWatchWake(state),
      this.retentionDeadline(state),
      this.chat.wakeAt(),
    ].filter((at): at is Instant => at !== null)
    if (wakeups.length === 0) this.alarm.clear()
    else this.alarm.set(Math.min(...wakeups))
  }

  // One past the end of the reroll window, so the alarm finds the giveaway finished and pushes it.
  private rerollWindowWake(state: RoomState): Instant | null {
    if (state.status !== "drawn") return null
    const end = this.rerollWindowEnd()
    if (end === null || end < this.clock.now() || !this.hasUndrawnEntrant()) return null
    return end + 1
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

// 128 bits, enough that a published leaf cannot be matched to an id by trying ids.
const saltBytes = 16

// A chunk of 1000 leaves is 40 KB, far inside the 2 MB value limit of a Durable Object, and a giveaway
// of 12,000 entrants writes 12 rows (spec Load budget) instead of one per entrant.
const leavesPerChunk = 1000
const hashBytes = 32
const ticketBytes = 8
const leafRecordBytes = hashBytes + ticketBytes

// The smallest bound-parameter limit among the targets (D1).
const maxBoundParameters = 100
const roleColumns = ["platform", "platform_user_id", "role", "fetched_at"] as const
const rolesPerInsert = Math.floor(maxBoundParameters / roleColumns.length)

const failureColumns = {
  "role-refresh": "role_refresh_failures",
  eventsub: "eventsub_failures",
} as const satisfies Record<FailureKind, string>

/** Drops the winner chat from a snapshot, for audiences that must not see viewers' messages. */
export function overlaySnapshot({
  winnerChat: _winnerChat,
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
  }
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
    case "drawn":
      return { kind: "already-drawn" }
    case "closed":
      return state.entriesDeleted ? { kind: "entries-deleted" } : null
  }
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

function liveWinner(row: SqlRow, now: Instant): LiveWinner {
  const draw = parseDraw(row)
  return {
    n: draw.n,
    entrySeq: new RowReader("entries", row).nullableInt("seq"),
    displayName: new RowReader("entries", row).nullableText("display_name"),
    claimUntil: draw.claimUntil,
    claim: winnerClaim(draw, now),
  }
}

function winnerClaim(draw: DrawRow, now: Instant): WinnerClaim {
  if (draw.claim.state === "claimed") {
    return { state: "claimed", at: draw.claim.at, via: draw.claim.via }
  }
  if (draw.rerolled) return { state: "rerolled" }
  return { state: now > draw.claimUntil ? "expired" : "waiting" }
}
