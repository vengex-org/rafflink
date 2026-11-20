import type { ResolvedConfig } from "../config.ts"
import { parseRules, type GiveawayRules } from "../domain/rules.ts"
import type { AsyncSql, Instant, SqlRow } from "../ports.ts"
import { RoomRowError, roomStatuses, RowReader, type RoomStatus } from "../room/rows.ts"
import {
  deleteStreamerTokenSql,
  giveawayByCodeSql,
  giveawayByIdSql,
  giveawaysOfStreamerSql,
  insertGiveawaySql,
  ownedGiveawaySql,
  replaceStreamerTokenSql,
  setStatusSql,
  streamerByPlatformUserSql,
  streamerTokenSql,
  streamerTokensSql,
  upsertStreamerSql,
  upsertStreamerTokenSql,
} from "./queries.ts"

export interface StreamerRecord {
  readonly id: string
  readonly platform: string
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
}

/** What a streamer sign-in stores: the streamer and their sealed refresh token, written together. */
export interface StreamerSignIn {
  /** Used only when the streamer is new. */
  readonly id: string
  readonly platform: string
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
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
