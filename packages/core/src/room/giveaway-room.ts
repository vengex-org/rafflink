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
  lastNamesSql,
  nextClaimDeadlineSql,
  recentEntriesCountSql,
  waitingPickOfChatterSql,
} from "./queries.ts"
import {
  parseDraw,
  parseEntry,
  parseState,
  RowReader,
  type ClaimedVia,
  type DrawRow,
  type EntrySummary,
  type RoomState,
  type RoomStatus,
} from "./rows.ts"

export type RoomConfig = Pick<
  ResolvedConfig,
  | "claimKeywordMaxLength"
  | "roleRefreshSeconds"
  | "liveIntervalMs"
  | "liveLastNames"
  | "liveRateWindowSeconds"
  | "mirrorRetrySeconds"
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
  readonly title: string
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
}

/** A winner's claim as the live page shows it. */
export type WinnerClaim =
  | { readonly state: "claimed"; readonly via: ClaimedVia }
  | { readonly state: "waiting" | "expired" | "rerolled" }

export interface LiveWinner {
  readonly n: number
  /** Null when the entry is gone. */
  readonly displayName: string | null
  readonly claimUntil: Instant
  readonly claim: WinnerClaim
}

/** A pick with who it went to. */
export interface WinnerPick extends LiveWinner, Identity {}

export interface LiveSnapshot extends RoomSummary {
  readonly title: string
  readonly code: string
  readonly entriesPerSecond: number
  readonly lastNames: readonly string[]
  readonly winners: readonly LiveWinner[]
  readonly roleRefreshFailures: number
  readonly eventSubFailures: number
  /** The live page shows "Chat claim unavailable"; the streamer marks claims by hand. */
  readonly chatClaimUnavailable: boolean
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
  private pushDueAt: Instant | null = null
  private mirrorRetryAt: Instant | null = null

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
      const existing = this.sql.exec(
        "SELECT group_name, tickets, entered_at FROM entries WHERE platform = ? AND platform_user_id = ?",
        [state.platform, viewer.platformUserId],
      )[0]
      if (existing !== undefined) return { kind: "already-in", entry: parseEntry(existing) }

      const eligibility = evaluateEligibility(
        state.rules,
        this.viewerFacts(state, viewer),
        state.broadcasterId,
      )
      if (!eligibility.eligible) return { kind: "not-eligible", reason: eligibility.reason }

      this.sql.exec(
        `INSERT INTO entries (platform, platform_user_id, login, display_name, group_name, tickets, entered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

  summary(): RoomSummary {
    return summarize(this.readState())
  }

  /** Stops entries. Idempotent: closing a room that is not open reports its status. */
  close(): CloseOutcome {
    if (!this.closeOpenRoom()) return { kind: "not-open", status: this.readState().status }
    this.mirrorRetryAt = this.clock.now() + this.config.mirrorRetrySeconds * 1000
    this.afterWrite()
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
    if (pushNow) this.guarded("live-push", () => this.pushLive())
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
      this.afterWrite()
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

    const next = Math.max(...draws.map((draw) => draw.n)) + 1
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
    if (outcome.kind === "rerolled") this.afterWrite()
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
      this.afterWrite()
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
      roleRefreshFailures: state.roleRefreshFailures,
      eventSubFailures: state.eventSubFailures,
      chatClaimUnavailable: state.chatUnavailable,
    }
  }

  private readState(): RoomState {
    const row = this.sql.exec("SELECT * FROM room_state WHERE id = 1", [])[0]
    if (row === undefined) throw new Error("room is not initialised")
    return parseState(row, this.config)
  }

  private readPickRows(): SqlRow[] {
    return this.sql.exec(
      `SELECT d.n, d.platform, d.platform_user_id, d.claim_until, d.claimed_at, d.claimed_via, d.rerolled, e.display_name
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
    this.live.broadcast(JSON.stringify(this.liveSnapshot()))
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
      this.chat.wakeAt(),
    ].filter((at): at is Instant => at !== null)
    if (wakeups.length === 0) this.alarm.clear()
    else this.alarm.set(Math.min(...wakeups))
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
