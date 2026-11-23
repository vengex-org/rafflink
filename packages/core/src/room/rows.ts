import { parseActor, type Actor } from "../domain/actor.ts"
import { groups, type Group } from "../domain/groups.ts"
import {
  parseRules,
  channelEntryVias,
  type ChannelEntryVia,
  type GiveawayRules,
  type RulesConfig,
} from "../domain/rules.ts"
import type { DrandChain } from "../lib/drand.ts"
import type { ChatterRoles } from "../platform/chat-source.ts"
import type { Instant, SqlRow } from "../ports.ts"

/** Where a giveaway is in its life: entries open, entries closed, winners drawn. Matches the `status` CHECK. */
export const roomStatuses = ["open", "closed", "drawn"] as const
export type RoomStatus = (typeof roomStatuses)[number]

/** How a winner claimed. Matches the `claimed_via` CHECK. */
export const claimedVias = ["rafflink", "chat", "manual"] as const
export type ClaimedVia = (typeof claimedVias)[number]

/** A stored value that breaks the schema's promise; the message names the column, never the value. */
export class RoomRowError extends Error {
  constructor(table: string, column: string) {
    super(`${table}.${column}: unexpected value`)
  }
}

/** What a closed room committed to before the draw: the Merkle root over its entrants and the drand round that will seed the draw. */
export interface Commitment {
  readonly merkleRoot: Uint8Array<ArrayBuffer>
  readonly drandRound: number
  readonly committedAt: Instant
  /** The chain the round belongs to, as the room's config named it at the commit. */
  readonly chain: DrandChain
}

/** The one `room_state` row, parsed. A drawn room has its seed, any other has none; an open room has no close time, any other has one. A room that closed before commitments existed has no commitment. */
export type RoomState = {
  readonly platform: string
  readonly giveawayId: string
  readonly broadcasterId: string
  readonly title: string | null
  readonly code: string
  readonly rules: GiveawayRules
  readonly claimSeconds: number
  readonly closesAt: Instant | null
  readonly entrantCount: number
  readonly ticketTotal: number
  readonly roleRefreshFailures: number
  readonly eventSubFailures: number
  /** The chat watch gave up; the draw and a reroll clear it. */
  readonly chatUnavailable: boolean
  /** Twitch refused the sub or points subscriptions while the chat subscription held. */
  readonly channelEntryUnavailable: boolean
  readonly rolesRefreshAt: Instant | null
  readonly mirrorPending: boolean
  /** The retention alarm deleted the entrants' data. */
  readonly entriesDeleted: boolean
  readonly commitment: Commitment | null
  /** Commit attempts the alarm made so far. */
  readonly commitAttempts: number
  /** When the alarm may attempt the commit again; null before the first attempt. */
  readonly commitRetryAt: Instant | null
  /** The alarm used up its attempts and logged it. */
  readonly commitGaveUp: boolean
  /** How many winners the streamer planned; the draw does not stop there. */
  readonly winnerCount: number
  /** The streamer pressed Draw before the round was published; the alarm draws once it is. */
  readonly drawRequested: boolean
  /** How many picks the requested draw adds; read only while `drawRequested`. */
  readonly drawCount: number
  /** When the alarm tries a requested draw next; null before the first try. */
  readonly drawRetryAt: Instant | null
  /** Who closed entries; null while open and when the end time closed them. */
  readonly closedBy: Actor | null
  /** Who pressed Draw while entries were open; null when nobody did. */
  readonly drawRequestedBy: Actor | null
  /** The excluded accounts are written; until then the room refuses entries. */
  readonly exclusionsLoaded: boolean
  /** The version of the streamer's block list the room holds. */
  readonly blockListVersion: number
} & (
  | { readonly status: "open"; readonly seed: null; readonly closedAt: null }
  | { readonly status: "closed"; readonly seed: null; readonly closedAt: Instant }
  | { readonly status: "drawn"; readonly seed: Uint8Array<ArrayBuffer>; readonly closedAt: Instant }
)

/** Whether a pick is still open to claim, was claimed, or is out. */
export type DrawClaim =
  | { readonly state: "unclaimed" }
  | { readonly state: "claimed"; readonly at: Instant; readonly via: ClaimedVia }

/** One `draws` row, parsed. */
export interface DrawRow {
  readonly n: number
  readonly platform: string
  readonly platformUserId: string
  readonly claimUntil: Instant
  readonly claim: DrawClaim
  readonly rerolled: boolean
  /** Null for a pick drawn before commitments existed. */
  readonly leafIndex: number | null
  /** Who pressed the draw or reroll that made this pick; null for picks drawn before actors were kept. */
  readonly drawnBy: Actor | null
  readonly rerolledBy: Actor | null
  /** Who marked the claim by hand; null for any other claim. */
  readonly claimMarkedBy: Actor | null
  /** When the winner sent the winner form; kept after the answers are deleted. */
  readonly answeredAt: Instant | null
  /** When the streamer marked the prize delivered. */
  readonly deliveredAt: Instant | null
}

export interface EntrySummary {
  readonly group: Group
  readonly tickets: number
  readonly enteredAt: Instant
}

export function parseState(row: SqlRow, config: RulesConfig): RoomState {
  const reader = new RowReader("room_state", row)
  const rules = parseRules(parseJson(reader.text("rules_json")), config)
  if (!rules.ok) throw new RoomRowError("room_state", "rules_json")
  const base = {
    platform: reader.text("platform"),
    giveawayId: reader.text("giveaway_id"),
    broadcasterId: reader.text("broadcaster_id"),
    title: reader.nullableText("title"),
    code: reader.text("code"),
    rules: rules.value,
    claimSeconds: reader.int("claim_seconds"),
    closesAt: reader.nullableInt("closes_at"),
    entrantCount: reader.int("entrant_count") - reader.int("removed_entrants"),
    ticketTotal: reader.int("ticket_total"),
    roleRefreshFailures: reader.int("role_refresh_failures"),
    eventSubFailures: reader.int("eventsub_failures"),
    chatUnavailable: reader.int("chat_unavailable") === 1,
    channelEntryUnavailable: reader.int("channel_entry_unavailable") === 1,
    rolesRefreshAt: reader.nullableInt("roles_refresh_at"),
    mirrorPending: reader.int("mirror_pending") === 1,
    entriesDeleted: reader.int("entries_deleted") === 1,
    commitment: parseCommitment(reader),
    commitAttempts: reader.int("commit_attempts"),
    commitRetryAt: reader.nullableInt("commit_retry_at"),
    commitGaveUp: reader.int("commit_gave_up") === 1,
    winnerCount: reader.int("winner_count"),
    drawRequested: reader.int("draw_requested") === 1,
    drawCount: reader.int("draw_count"),
    drawRetryAt: reader.nullableInt("draw_retry_at"),
    closedBy: reader.nullableActor("closed_by"),
    drawRequestedBy: reader.nullableActor("draw_requested_by"),
    exclusionsLoaded: reader.int("exclusions_loaded") === 1,
    blockListVersion: reader.int("block_list_version"),
  }
  const status = reader.oneOf("status", roomStatuses)
  const seed = reader.nullableBlob("seed")
  const closedAt = reader.nullableInt("closed_at")
  if (status === "open") {
    if (seed !== null || closedAt !== null) throw new RoomRowError("room_state", "closed_at")
    return { ...base, status, seed, closedAt }
  }
  if (closedAt === null) throw new RoomRowError("room_state", "closed_at")
  if (status === "drawn") {
    if (seed === null) throw new RoomRowError("room_state", "seed")
    return { ...base, status, seed, closedAt }
  }
  if (seed !== null) throw new RoomRowError("room_state", "seed")
  return { ...base, status, seed, closedAt }
}

export function parseDraw(row: SqlRow): DrawRow {
  const reader = new RowReader("draws", row)
  const claimedAt = reader.nullableInt("claimed_at")
  const claimedVia = reader.nullableText("claimed_via")
  return {
    n: reader.int("n"),
    platform: reader.text("platform"),
    platformUserId: reader.text("platform_user_id"),
    claimUntil: reader.int("claim_until"),
    claim: parseClaim(claimedAt, claimedVia),
    rerolled: reader.int("rerolled") === 1,
    leafIndex: reader.nullableInt("leaf_index"),
    drawnBy: reader.nullableActor("drawn_by"),
    rerolledBy: reader.nullableActor("rerolled_by"),
    claimMarkedBy: reader.nullableActor("claim_marked_by"),
    answeredAt: reader.nullableInt("answered_at"),
    deliveredAt: reader.nullableInt("delivered_at"),
  }
}

export function parseEntry(row: SqlRow): EntrySummary {
  const reader = new RowReader("entries", row)
  return {
    group: reader.oneOf("group_name", groups),
    tickets: reader.int("tickets"),
    enteredAt: reader.int("entered_at"),
  }
}

/** One entry as the streamer's entrants table lists it. `seq` counts entries in the order they were written, from 1. */
export interface Entrant {
  readonly seq: number
  readonly login: string
  readonly displayName: string
  readonly tickets: number
  readonly group: Group
  /** Null when the entry has no picture on Twitch's image host. */
  readonly profileImageUrl: string | null
}

export function parseEntrant(row: SqlRow): Entrant {
  const reader = new RowReader("entries", row)
  return {
    seq: reader.int("seq"),
    login: reader.text("login"),
    displayName: reader.text("display_name"),
    tickets: reader.int("tickets"),
    group: reader.oneOf("group_name", groups),
    profileImageUrl: reader.nullableText("profile_image_url"),
  }
}

/** A viewer waiting for the check of their chat, sub or points entry: who they are, how they asked and what their chat badges or the sub event said. */
export interface ChatRequest {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  readonly via: ChannelEntryVia
  readonly roles: ChatterRoles
}

export function parseChatRequest(row: SqlRow): ChatRequest {
  const reader = new RowReader("chat_entry_requests", row)
  const subTier = reader.nullableInt("sub_tier")
  if (subTier !== null && subTier !== 1 && subTier !== 2 && subTier !== 3) {
    throw new RoomRowError("chat_entry_requests", "sub_tier")
  }
  return {
    platformUserId: reader.text("platform_user_id"),
    login: reader.text("login"),
    displayName: reader.text("display_name"),
    via: reader.oneOf("via", channelEntryVias),
    roles: {
      subTier,
      isVip: reader.int("vip") === 1,
      isModerator: reader.int("moderator") === 1,
    },
  }
}

/** Reads typed columns of one row; a mismatch throws {@link RoomRowError}. */
export class RowReader {
  constructor(
    private readonly table: string,
    private readonly row: SqlRow,
  ) {}

  text(column: string): string {
    const value = this.row[column]
    if (typeof value !== "string") throw new RoomRowError(this.table, column)
    return value
  }

  nullableText(column: string): string | null {
    return this.row[column] === null ? null : this.text(column)
  }

  int(column: string): number {
    const value = this.row[column]
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new RoomRowError(this.table, column)
    }
    return value
  }

  nullableInt(column: string): number | null {
    return this.row[column] === null ? null : this.int(column)
  }

  blob(column: string): Uint8Array<ArrayBuffer> {
    const value = this.nullableBlob(column)
    if (value === null) throw new RoomRowError(this.table, column)
    return value
  }

  nullableBlob(column: string): Uint8Array<ArrayBuffer> | null {
    const value = this.row[column]
    if (value === null) return null
    if (!(value instanceof Uint8Array)) throw new RoomRowError(this.table, column)
    return new Uint8Array(value)
  }

  nullableActor(column: string): Actor | null {
    const value = this.nullableText(column)
    if (value === null) return null
    const actor = parseActor(value)
    if (actor === null) throw new RoomRowError(this.table, column)
    return actor
  }

  oneOf<T extends string>(column: string, allowed: readonly T[]): T {
    const value = this.text(column)
    const found = allowed.find((item) => item === value)
    if (found === undefined) throw new RoomRowError(this.table, column)
    return found
  }
}

function parseCommitment(reader: RowReader): Commitment | null {
  const merkleRoot = reader.nullableBlob("merkle_root")
  const drandRound = reader.nullableInt("drand_round")
  const committedAt = reader.nullableInt("committed_at")
  const chainHash = reader.nullableText("drand_chain_hash")
  const genesisSeconds = reader.nullableInt("drand_genesis_seconds")
  const periodSeconds = reader.nullableInt("drand_period_seconds")
  if (
    merkleRoot === null
    && drandRound === null
    && committedAt === null
    && chainHash === null
    && genesisSeconds === null
    && periodSeconds === null
  ) {
    return null
  }
  if (
    merkleRoot === null
    || drandRound === null
    || committedAt === null
    || chainHash === null
    || genesisSeconds === null
    || periodSeconds === null
  ) {
    throw new RoomRowError("room_state", "merkle_root")
  }
  return {
    merkleRoot,
    drandRound,
    committedAt,
    chain: { chainHash, genesisSeconds, periodSeconds },
  }
}

function parseClaim(claimedAt: Instant | null, claimedVia: string | null): DrawClaim {
  if (claimedAt === null && claimedVia === null) return { state: "unclaimed" }
  const via = claimedVias.find((item) => item === claimedVia)
  if (claimedAt === null || via === undefined) throw new RoomRowError("draws", "claimed_via")
  return { state: "claimed", at: claimedAt, via }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new RoomRowError("room_state", "rules_json")
  }
}
