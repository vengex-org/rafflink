import type { ResolvedConfig } from "../config.ts"
import { groups, type Group } from "../domain/groups.ts"
import { parseRules, type GiveawayRules } from "../domain/rules.ts"
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

/** The one `room_state` row, parsed. A drawn room has its seed, any other has none. */
export type RoomState = {
  readonly platform: string
  readonly giveawayId: string
  readonly broadcasterId: string
  readonly title: string
  readonly code: string
  readonly rules: GiveawayRules
  readonly claimSeconds: number
  readonly closesAt: Instant | null
  readonly entrantCount: number
  readonly ticketTotal: number
  readonly roleRefreshFailures: number
  readonly eventSubFailures: number
  /** The chat watch gave up; a reroll clears it. */
  readonly chatUnavailable: boolean
  readonly rolesRefreshAt: Instant | null
  readonly mirrorPending: boolean
} & (
  | { readonly status: "open" | "closed"; readonly seed: null }
  | { readonly status: "drawn"; readonly seed: Uint8Array<ArrayBuffer> }
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
}

export interface EntrySummary {
  readonly group: Group
  readonly tickets: number
  readonly enteredAt: Instant
}

export function parseState(
  row: SqlRow,
  config: Pick<ResolvedConfig, "claimKeywordMaxLength">,
): RoomState {
  const reader = new RowReader("room_state", row)
  const rules = parseRules(parseJson(reader.text("rules_json")), config)
  if (!rules.ok) throw new RoomRowError("room_state", "rules_json")
  const base = {
    platform: reader.text("platform"),
    giveawayId: reader.text("giveaway_id"),
    broadcasterId: reader.text("broadcaster_id"),
    title: reader.text("title"),
    code: reader.text("code"),
    rules: rules.value,
    claimSeconds: reader.int("claim_seconds"),
    closesAt: reader.nullableInt("closes_at"),
    entrantCount: reader.int("entrant_count"),
    ticketTotal: reader.int("ticket_total"),
    roleRefreshFailures: reader.int("role_refresh_failures"),
    eventSubFailures: reader.int("eventsub_failures"),
    chatUnavailable: reader.int("chat_unavailable") === 1,
    rolesRefreshAt: reader.nullableInt("roles_refresh_at"),
    mirrorPending: reader.int("mirror_pending") === 1,
  }
  const status = reader.oneOf("status", roomStatuses)
  const seed = reader.nullableBlob("seed")
  if (status === "drawn") {
    if (seed === null) throw new RoomRowError("room_state", "seed")
    return { ...base, status, seed }
  }
  if (seed !== null) throw new RoomRowError("room_state", "seed")
  return { ...base, status, seed }
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

  nullableBlob(column: string): Uint8Array<ArrayBuffer> | null {
    const value = this.row[column]
    if (value === null) return null
    if (!(value instanceof Uint8Array)) throw new RoomRowError(this.table, column)
    return new Uint8Array(value)
  }

  oneOf<T extends string>(column: string, allowed: readonly T[]): T {
    const value = this.text(column)
    const found = allowed.find((item) => item === value)
    if (found === undefined) throw new RoomRowError(this.table, column)
    return found
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
