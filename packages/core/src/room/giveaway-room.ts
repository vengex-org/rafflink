import type { ResolvedConfig } from "../config.ts"
import {
  evaluateEligibility,
  type GiveawayRules,
  type IneligibleReason,
  type ViewerFacts,
} from "../domain/rules.ts"
import { drawWinners, pickWinner, type DrawEntry, type Identity, type Winner } from "../lib/draw.ts"
import type { Alarm, Clock, Instant, LiveHub, Random, SqlRow, SqlValue, SyncSql } from "../ports.ts"
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
  undrawnEntrantSql,
  recentEntriesCountSql,
  waitingPickOfChatterSql,
} from "./queries.ts"
import {
  parseDraw,
  parseEntrant,
  parseEntry,
  parseState,
  RowReader,
  type ClaimedVia,
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
  | "liveRateWindowSeconds"
  | "mirrorRetrySeconds"
  | "rerollWindowSeconds"
>
  & ChatWatcherConfig

export interface RoomDeps {
  readonly sql: SyncSql
  readonly alarm: Alarm
  readonly live: LiveHub
  readonly clock: Clock
  readonly random: Random
  readonly config: RoomConfig
  /** How this target reaches Twitch chat while a winner waits to claim. */
  readonly chat: ChatLink
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

export type DrawOutcome =
  | { readonly kind: "drawn"; readonly winners: readonly Winner[] }
  | { readonly kind: "not-closed" }
  | { readonly kind: "already-drawn" }

export type RerollOutcome =
  | { readonly kind: "rerolled"; readonly replaced: number; readonly winner: Winner }
  | { readonly kind: "already-rerolled" }
  | { readonly kind: "already-claimed" }
  | { readonly kind: "unknown-pick" }
  | { readonly kind: "not-drawn" }
  | { readonly kind: "no-entrants-left" }
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
}

export type FailureKind = "role-refresh" | "eventsub"

export interface RoomSummary {
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly entrantCount: number
  readonly ticketTotal: number
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
  | { readonly state: "claimed"; readonly via: ClaimedVia }
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

export interface LiveSnapshot extends RoomSummary {
  /** A streamer can still reroll an unclaimed pick; false once the reroll window after the last claim deadline is over. */
  readonly rerollOpen: boolean
  readonly title: string | null
  readonly code: string
  readonly entriesPerSecond: number
  readonly lastNames: readonly string[]
  readonly winners: readonly LiveWinner[]
  readonly roleRefreshFailures: number
  readonly eventSubFailures: number
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
export interface LivePush extends LiveSnapshot {
  readonly entrantsAfter: EntrantsDelta
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
  private readonly chat: ChatWatcher
  private lastPushAt: Instant | null = null
  // Lost with the object; the first push after that carries no rows and the page fetches the gap.
  private lastPushedSeq: number | null = null
  private pushDueAt: Instant | null = null
  // Lost with the object; the first outcome after that is pushed again.
  private lastViewerOutcome: string | null = null
  private mirrorRetryAt: Instant | null = null
  // Lost with the object; the first reroll window end after that is not pushed to the live pages.
  private lastLiveRerollOpen: boolean | null = null

  constructor(deps: RoomDeps) {
    this.sql = deps.sql
    this.alarm = deps.alarm
    this.live = deps.live
    this.clock = deps.clock
    this.random = deps.random
    this.config = deps.config
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
         (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, closes_at, roles_refresh_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
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
      ],
    )
    this.reconcile()
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
        `INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at)
         VALUES ((SELECT entrant_count + 1 FROM room_state WHERE id = 1), ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.platform,
          viewer.platformUserId,
          viewer.login,
          viewer.displayName,
          eligibility.group,
          eligibility.tickets,
          now,
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

  /** Runs when the alarm fires: closes at the end time, pushes a held live update, reports what is left to the caller. */
  onAlarm(): AlarmDuties {
    const now = this.clock.now()
    let state = this.readState()
    let pushNow = this.pushDueAt !== null && now >= this.pushDueAt
    if (state.status === "open" && state.closesAt !== null && now >= state.closesAt) {
      pushNow = this.closeOpenRoom() || pushNow
      state = this.readState()
    }
    pushNow = (this.lastLiveRerollOpen === true && !this.liveSnapshot().rerollOpen) || pushNow
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
    this.guarded("chat", () => {
      this.syncChat()
      this.chat.onAlarm()
    })
    this.guarded("alarm", () => this.rearm())
    return { refreshRoles, mirrorStatus: mirrorDue ? state.status : null }
  }

  /** Clears the pending mirror once `status` reached the account store; a newer status stays pending. */
  markMirrored(status: RoomStatus): void {
    this.sql.exec("UPDATE room_state SET mirror_pending = 0 WHERE id = 1 AND status = ?", [status])
    this.guarded("alarm", () => this.rearm())
  }

  /** Picks `count` winners from a closed room, once. */
  async draw(count: number): Promise<DrawOutcome> {
    const state = this.readState()
    const refusal = drawRefusal(state.status)
    if (refusal !== null) return refusal
    const seed = new Uint8Array(this.random.bytes(seedBytes))
    const winners = await drawWinners(seed, this.readDrawEntries(), count)
    const now = this.clock.now()
    const outcome = this.sql.transaction((): DrawOutcome => {
      const flipped = this.sql.exec(
        "UPDATE room_state SET status = 'drawn', seed = ?, mirror_pending = 1 WHERE id = 1 AND status = 'closed' RETURNING id",
        [seed],
      )
      if (flipped.length === 0)
        return drawRefusal(this.readState().status) ?? { kind: "not-closed" }
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
    const draws = this.readDraws()
    const refusal = rerollRefusal(draws.find((draw) => draw.n === n) ?? null)
    if (refusal !== null) return refusal
    if (this.rerollWindowOver()) return { kind: "reroll-window-over" }

    const next = draws.reduce((highest, draw) => Math.max(highest, draw.n), -1) + 1
    const picked = await pickWinner(state.seed, next, this.readDrawEntries(), draws)
    if (picked === null) return { kind: "no-entrants-left" }
    const winner: Winner = { n: next, ...picked }
    const now = this.clock.now()
    const outcome = this.sql.transaction((): RerollOutcome => {
      const current = rerollRefusal(this.readDraw(n))
      if (current !== null) return current
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
    if (outcome.kind === "rerolled") this.afterOutcomeWrite()
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
      rerollOpen:
        state.status === "drawn" && this.rerollWindowEnd() !== null && !this.rerollWindowOver(),
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
      `SELECT d.n, d.platform, d.platform_user_id, d.claim_until, d.claimed_at, d.claimed_via, d.rerolled, e.display_name, e.seq
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
      "INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until) VALUES (?, ?, ?, ?, ?)",
      [winner.n, winner.platform, winner.platformUserId, now, now + claimSeconds * 1000],
    )
  }

  private closeOpenRoom(): boolean {
    const closed = this.sql.exec(
      "UPDATE room_state SET status = 'closed', mirror_pending = 1 WHERE id = 1 AND status = 'open' RETURNING id",
      [],
    )
    return closed.length > 0
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

  // The watcher runs while a winner waits to claim, until it gave up for this giveaway.
  private syncChat(): void {
    const state = this.readState()
    const waiting = state.status === "drawn" && this.nextClaimDeadline() !== null
    if (waiting && !state.chatUnavailable) this.chat.open()
    else this.chat.close()
  }

  /** The end of the soonest claim time among winners who may still claim, `null` when none waits. */
  private nextClaimDeadline(): Instant | null {
    const row = this.sql.exec(nextClaimDeadlineSql, [this.clock.now()])[0]
    return row === undefined ? null : new RowReader("draws", row).nullableInt("deadline")
  }

  // A message from the waiting winner claims; every other message is dropped here, unread and unlogged.
  private onChatMessage(message: ChatMessage): void {
    const now = this.clock.now()
    const pick = this.sql.exec(waitingPickOfChatterSql, [message.chatterUserId, now])[0]
    if (pick === undefined) return
    const state = this.readState()
    const { claimKeyword } = state.rules
    if (
      claimKeyword !== null
      && !message.text.toLowerCase().includes(claimKeyword.trim().toLowerCase())
    ) {
      return
    }
    this.claim(
      new RowReader("draws", pick).int("n"),
      { platform: state.platform, platformUserId: message.chatterUserId },
      "chat",
    )
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
    const push: LivePush = { ...this.liveSnapshot(), entrantsAfter: this.entrantsDelta() }
    this.lastLiveRerollOpen = push.rerollOpen
    this.live.broadcast(JSON.stringify(push))
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

  private rerollWindowEnd(): Instant | null {
    const last = this.lastClaimDeadline()
    return last === null ? null : last + this.config.rerollWindowSeconds * 1000
  }

  private rerollWindowOver(): boolean {
    const end = this.rerollWindowEnd()
    return end !== null && this.clock.now() > end
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
      // One past the inclusive deadline, so the alarm finds the claim time over and closes the chat watch.
      claimDeadline === null ? null : claimDeadline + 1,
      this.rerollWindowWake(state),
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

// 256 bits, the HMAC-SHA256 key size.
const seedBytes = 32

// The smallest bound-parameter limit among the targets (D1).
const maxBoundParameters = 100
const roleColumns = ["platform", "platform_user_id", "role", "fetched_at"] as const
const rolesPerInsert = Math.floor(maxBoundParameters / roleColumns.length)

const failureColumns = {
  "role-refresh": "role_refresh_failures",
  eventsub: "eventsub_failures",
} as const satisfies Record<FailureKind, string>

function summarize(state: RoomState): RoomSummary {
  return {
    status: state.status,
    closesAt: state.closesAt,
    entrantCount: state.entrantCount,
    ticketTotal: state.ticketTotal,
    chatClaimUnavailable: state.chatUnavailable,
  }
}

function drawRefusal(status: RoomStatus): DrawOutcome | null {
  switch (status) {
    case "open":
      return { kind: "not-closed" }
    case "drawn":
      return { kind: "already-drawn" }
    case "closed":
      return null
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
  if (draw.claim.state === "claimed") return { state: "claimed", via: draw.claim.via }
  if (draw.rerolled) return { state: "rerolled" }
  return { state: now > draw.claimUntil ? "expired" : "waiting" }
}
