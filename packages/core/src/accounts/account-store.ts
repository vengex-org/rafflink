import type { ResolvedConfig } from "../config.ts"
import { cloudflarePlans, type CloudflarePlan } from "../plan/plan-limits.ts"
import { parseRules, type GiveawayRules } from "../domain/rules.ts"
import type { AsyncSql, Instant, SqlRow } from "../ports.ts"
import { RoomRowError, roomStatuses, RowReader, type RoomStatus } from "../room/rows.ts"
import {
  cloudflarePlanSql,
  approvedStreamersSql,
  approveStreamerSql,
  deleteStreamerTokenSql,
  giveawayByCodeSql,
  giveawayByIdSql,
  giveawaysOfStreamerSql,
  insertGiveawaySql,
  ownedGiveawaySql,
  pendingStreamersSql,
  recordRetentionFailureSql,
  replaceStreamerTokenSql,
  revokeStreamerSql,
  setRetentionArmedSql,
  setStatusSql,
  storeCloudflarePlanSql,
  streamerByIdSql,
  streamerByPlatformUserSql,
  streamerTokenSql,
  streamerTokensSql,
  unarmedRetentionSql,
  upsertStreamerSql,
  upsertStreamerTokenSql,
} from "./queries.ts"

export interface StreamerRecord {
  readonly id: string
  readonly platform: string
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  /** Null when the streamer has no picture on Twitch's image host. */
  readonly profileImageUrl: string | null
  /** First sign-in. */
  readonly createdAt: Instant
  /** When an admin approved the account; null while it waits. Only read when OPEN_SIGNUP is false. */
  readonly approvedAt: Instant | null
}

/** What a streamer sign-in stores: the streamer and their sealed refresh token, written together. */
export interface StreamerSignIn {
  /** Used only when the streamer is new. */
  readonly id: string
  readonly platform: string
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  readonly profileImageUrl: string | null
  readonly sealedRefreshToken: string
  readonly scopes: string
  readonly now: Instant
}

/** A streamer's sealed refresh token with the identity it is sealed to. */
export interface StoredStreamerToken {
  readonly streamerId: string
  readonly platform: string
  readonly platformUserId: string
  readonly sealedRefreshToken: string
}

/** A giveaway as the account store holds it. `status` mirrors the room, which owns it. */
export interface Giveaway {
  readonly id: string
  readonly code: string
  readonly streamerId: string
  readonly platform: string
  /** The streamer's user id on the platform. */
  readonly broadcasterId: string
  /** How the streamer's name is shown to viewers. */
  readonly streamerName: string
  readonly title: string | null
  readonly prize: string | null
  readonly rules: GiveawayRules
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly claimSeconds: number
  /** How many winners the draw picks, as chosen at creation; the room owns the live value. */
  readonly winnerCount: number
  readonly overlayToken: string
  readonly createdAt: Instant
}

export type NewGiveaway = Omit<Giveaway, "platform" | "broadcasterId" | "streamerName" | "status">

export type InsertOutcome = "inserted" | "code-taken"

/** Streamers, their sealed tokens and giveaways over one SQLite database. Every streamer-facing lookup takes the owner. */
export class AccountStore {
  constructor(
    private readonly sql: AsyncSql,
    private readonly config: Pick<ResolvedConfig, "claimKeywordMaxLength" | "ticketsPerGroupMax">,
  ) {}

  /** Creates or updates the streamer and replaces their refresh token in one batch. */
  async signInStreamer(input: StreamerSignIn): Promise<StreamerRecord> {
    await this.sql.batch([
      {
        sql: upsertStreamerSql,
        params: [
          input.id,
          input.platform,
          input.platformUserId,
          input.login,
          input.displayName,
          input.profileImageUrl,
          input.now,
        ],
      },
      {
        sql: upsertStreamerTokenSql,
        params: [
          input.sealedRefreshToken,
          input.scopes,
          input.now,
          input.platform,
          input.platformUserId,
        ],
      },
    ])
    const [row] = await this.sql.all(streamerByPlatformUserSql, [
      input.platform,
      input.platformUserId,
    ])
    if (row === undefined) throw new RoomRowError("streamers", "id")
    return parseStreamer(row)
  }

  /** Every stored token, for the hourly validation. */
  async listStreamerTokens(): Promise<StoredStreamerToken[]> {
    return (await this.sql.all(streamerTokensSql, [])).map(parseStoredToken)
  }

  async findStreamer(id: string): Promise<StreamerRecord | null> {
    const [row] = await this.sql.all(streamerByIdSql, [id])
    return row === undefined ? null : parseStreamer(row)
  }

  async findStreamerToken(streamerId: string): Promise<StoredStreamerToken | null> {
    const [row] = await this.sql.all(streamerTokenSql, [streamerId])
    return row === undefined ? null : parseStoredToken(row)
  }

  /** Stores the refresh token Twitch returned in place of the one that was sent. */
  async replaceStreamerToken(
    streamerId: string,
    sealedRefreshToken: string,
    now: Instant,
  ): Promise<void> {
    await this.sql.run(replaceStreamerTokenSql, [sealedRefreshToken, now, streamerId])
  }

  /** Removes the token only: the streamer and their giveaways stay, and signing in again stores a new one. */
  async deleteStreamerToken(streamerId: string): Promise<void> {
    await this.sql.run(deleteStreamerTokenSql, [streamerId])
  }

  /** `code-taken` when another giveaway holds the code; nothing is written then. */
  async insertGiveaway(giveaway: NewGiveaway): Promise<InsertOutcome> {
    const rows = await this.sql.all(insertGiveawaySql, [
      giveaway.id,
      giveaway.code,
      giveaway.streamerId,
      giveaway.title,
      giveaway.prize,
      JSON.stringify(giveaway.rules),
      giveaway.closesAt,
      giveaway.claimSeconds,
      giveaway.winnerCount,
      giveaway.overlayToken,
      giveaway.createdAt,
    ])
    return rows.length === 1 ? "inserted" : "code-taken"
  }

  /** Public lookup for the giveaway page and the viewer sign-in. */
  async findGiveawayByCode(code: string): Promise<Giveaway | null> {
    return this.findOne(giveawayByCodeSql, [code])
  }

  /** Not owner-scoped: only for the token queue, which holds a giveaway id and no streamer. */
  async findGiveawayById(id: string): Promise<Giveaway | null> {
    return this.findOne(giveawayByIdSql, [id])
  }

  /** A giveaway of this streamer; another streamer's id finds nothing. */
  async findOwnedGiveaway(streamerId: string, id: string): Promise<Giveaway | null> {
    return this.findOne(ownedGiveawaySql, [id, streamerId])
  }

  async listGiveaways(streamerId: string): Promise<Giveaway[]> {
    const rows = await this.sql.all(giveawaysOfStreamerSql, [streamerId])
    return rows.map((row) => this.parseGiveaway(row))
  }

  /** Idempotent mirror of the room's status. */
  async setStatus(giveawayId: string, status: RoomStatus): Promise<void> {
    await this.sql.run(setStatusSql, [status, giveawayId])
  }

  /**
   * Ids of up to `limit` giveaways that are no longer open and whose room the retention sweep has not
   * woken, those with the fewest failed sweeps first; a giveaway with `maxAttempts` failed sweeps is left out.
   */
  async listUnarmedRetention(limit: number, maxAttempts: number): Promise<string[]> {
    const rows = await this.sql.all(unarmedRetentionSql, [maxAttempts, limit])
    return rows.map((row) => new RowReader("giveaways", row).text("id"))
  }

  /** Counts a failed sweep of the giveaway and returns how many have failed so far. */
  async recordRetentionFailure(giveawayId: string): Promise<number> {
    const [row] = await this.sql.all(recordRetentionFailureSql, [giveawayId])
    return row === undefined ? 0 : new RowReader("giveaways", row).int("retention_attempts")
  }

  /** Idempotent: the sweep never lists the giveaway again. */
  async markRetentionArmed(giveawayId: string): Promise<void> {
    await this.sql.run(setRetentionArmedSql, [giveawayId])
  }

  /** The Cloudflare plan an admin switched to, or null when nobody has. */
  async storedCloudflarePlan(): Promise<CloudflarePlan | null> {
    const [row] = await this.sql.all(cloudflarePlanSql, [])
    return row === undefined
      ? null
      : new RowReader("cloudflare_plan", row).oneOf("plan", cloudflarePlans)
  }

  /** Idempotent: the row keeps only the latest switch. `changedBy` is the admin's Twitch user id. */
  async storeCloudflarePlan(plan: CloudflarePlan, changedBy: string, at: Instant): Promise<void> {
    await this.sql.run(storeCloudflarePlanSql, [plan, at, changedBy])
  }

  /** Streamers waiting for approval and approved ones, each newest first and cut to `limit`. */
  async listStreamerAccess(
    limit: number,
  ): Promise<{ pending: StreamerRecord[]; approved: StreamerRecord[] }> {
    const [pending, approved] = await Promise.all([
      this.sql.all(pendingStreamersSql, [limit]),
      this.sql.all(approvedStreamersSql, [limit]),
    ])
    return { pending: pending.map(parseStreamer), approved: approved.map(parseStreamer) }
  }

  /** Idempotent: an earlier approval keeps its time and approver. False when no such streamer exists. */
  async approveStreamer(streamerId: string, approvedBy: string, at: Instant): Promise<boolean> {
    return (await this.sql.all(approveStreamerSql, [at, approvedBy, streamerId])).length === 1
  }

  /** Idempotent. False when no such streamer exists. */
  async revokeStreamer(streamerId: string): Promise<boolean> {
    return (await this.sql.all(revokeStreamerSql, [streamerId])).length === 1
  }

  private async findOne(sql: string, params: readonly string[]): Promise<Giveaway | null> {
    const [row] = await this.sql.all(sql, params)
    return row === undefined ? null : this.parseGiveaway(row)
  }

  private parseGiveaway(row: SqlRow): Giveaway {
    const reader = new RowReader("giveaways", row)
    const rules = parseRules(parseRulesJson(reader.text("rules_json")), this.config)
    if (!rules.ok) throw new RoomRowError("giveaways", "rules_json")
    return {
      id: reader.text("id"),
      code: reader.text("code"),
      streamerId: reader.text("streamer_id"),
      platform: reader.text("platform"),
      broadcasterId: reader.text("broadcaster_id"),
      streamerName: reader.text("streamer_name"),
      title: reader.nullableText("title"),
      prize: reader.nullableText("prize"),
      rules: rules.value,
      status: reader.oneOf("status", roomStatuses),
      closesAt: reader.nullableInt("closes_at"),
      claimSeconds: reader.int("claim_seconds"),
      winnerCount: reader.int("winner_count"),
      overlayToken: reader.text("overlay_token"),
      createdAt: reader.int("created_at"),
    }
  }
}

function parseStreamer(row: SqlRow): StreamerRecord {
  const reader = new RowReader("streamers", row)
  return {
    id: reader.text("id"),
    platform: reader.text("platform"),
    platformUserId: reader.text("platform_user_id"),
    login: reader.text("login"),
    displayName: reader.text("display_name"),
    profileImageUrl: reader.nullableText("profile_image_url"),
    createdAt: reader.int("created_at"),
    approvedAt: reader.nullableInt("approved_at"),
  }
}

function parseStoredToken(row: SqlRow): StoredStreamerToken {
  const reader = new RowReader("streamer_tokens", row)
  return {
    streamerId: reader.text("streamer_id"),
    platform: reader.text("platform"),
    platformUserId: reader.text("platform_user_id"),
    sealedRefreshToken: reader.text("refresh_token_enc"),
  }
}

function parseRulesJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new RoomRowError("giveaways", "rules_json")
  }
}
