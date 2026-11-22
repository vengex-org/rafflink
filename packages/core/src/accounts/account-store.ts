import { cloudflarePlans, type CloudflarePlan } from "../plan/plan-limits.ts"
import {
  defaultOverlayTheme,
  parseOverlayTheme,
  type OverlayTheme,
} from "../domain/overlay-theme.ts"
import { parseRules, type GiveawayRules, type RulesConfig } from "../domain/rules.ts"
import type { AsyncSql, Instant, SqlRow } from "../ports.ts"
import { RoomRowError, roomStatuses, RowReader, type RoomStatus } from "../room/rows.ts"
import {
  cloudflarePlanSql,
  approvedStreamersSql,
  approveStreamerSql,
  activeModeratorLinksSql,
  deleteGiveawayModeratorLinksSql,
  bumpBlockListVersionSql,
  blockListVersionSql,
  blockSql,
  blocksOfStreamerSql,
  deleteBlockSql,
  deleteStreamerBlocksSql,
  deleteGiveawaySql,
  deleteStreamerModeratorLinksSql,
  deleteStreamerGiveawaysSql,
  deleteStreamerSql,
  deleteStreamerTokenSql,
  expiredGiveawaysSql,
  giveawayByCodeSql,
  giveawayByIdSql,
  giveawaysOfStreamerSql,
  insertBlockSql,
  insertGiveawaySql,
  insertModeratorLinkSql,
  moderatorLinkByIdSql,
  openGiveawaysOfStreamerSql,
  ownedGiveawaySql,
  ownedOverlayThemesSql,
  overlayThemesSql,
  pendingStreamersSql,
  recentDrawnGiveawaysSql,
  recordRetentionFailureSql,
  replaceStreamerTokenSql,
  revokeModeratorLinkSql,
  revokeStreamerSql,
  setGiveawayOverlaySql,
  setRetentionArmedSql,
  setStatusSql,
  storeCloudflarePlanSql,
  storeStreamerOverlaySql,
  streamerByIdSql,
  streamerByPlatformUserSql,
  streamerOverlaySql,
  streamerThemedGiveawaysSql,
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
  /** The streamer's `block_list_version` when the row was read; the room must hold at least this list before an entry. */
  readonly blockListVersion: number
}

export type NewGiveaway = Omit<
  Giveaway,
  "platform" | "broadcasterId" | "streamerName" | "status" | "blockListVersion"
>

/** A link that lets whoever opens it act on one giveaway as its moderator; the store keeps a hash of its token, never the token. */
export interface ModeratorLink {
  readonly id: string
  readonly streamerId: string
  readonly giveawayId: string
  /** SHA-256 hex of the link's secret; the secret itself is only in the link. */
  readonly tokenHash: string
  /** The opener must be signed in as a moderator of the giveaway's channel. */
  readonly requireMod: boolean
  readonly createdAt: Instant
  /** Null while the link works. */
  readonly revokedAt: Instant | null
}

export type NewModeratorLink = Omit<ModeratorLink, "revokedAt">

export type InsertOutcome = "inserted" | "code-taken"

/** The overlay themes a streamer edits for one giveaway: its own, null while the streamer's applies, and the streamer's. */
export interface OwnedOverlayThemes {
  readonly own: OverlayTheme | null
  readonly streamer: OverlayTheme
}

/** An account a streamer keeps out of every one of their giveaways. */
export interface StreamerBlock {
  readonly platform: string
  readonly platformUserId: string
  /** The login when the block was saved; the account may have been renamed since. */
  readonly login: string
  readonly createdAt: Instant
}

/** `full` when the streamer holds the most blocks allowed; nothing is written then, nor for `exists`. */
export type AddBlockOutcome = "added" | "exists" | "full"

/** Streamers, their sealed tokens and giveaways over one SQLite database. Every streamer-facing lookup takes the owner. */
export class AccountStore {
  constructor(
    private readonly sql: AsyncSql,
    private readonly config: RulesConfig,
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

  /** Ids of up to `limit` of the streamer's giveaways whose mirrored status is still open, newest first. */
  async listOpenGiveawayIds(streamerId: string, limit: number): Promise<string[]> {
    const rows = await this.sql.all(openGiveawaysOfStreamerSql, [streamerId, limit])
    return rows.map((row) => new RowReader("giveaways", row).text("id"))
  }

  /** Ids of up to `limit` of the streamer's drawn giveaways created at or after `since`, newest first. */
  async listRecentDrawnGiveawayIds(
    streamerId: string,
    since: Instant,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.sql.all(recentDrawnGiveawaysSql, [streamerId, since, limit])
    return rows.map((row) => new RowReader("giveaways", row).text("id"))
  }

  /**
   * The streamer's block list on one platform with its version. The version is read first, so an edit
   * in between leaves a list newer than its version, which a room only reloads once more.
   */
  async blockList(
    streamerId: string,
    platform: string,
  ): Promise<{ version: number; blocks: StreamerBlock[] }> {
    const [row] = await this.sql.all(blockListVersionSql, [streamerId])
    if (row === undefined) throw new RoomRowError("streamers", "id")
    const version = new RowReader("streamers", row).int("block_list_version")
    return { version, blocks: await this.listBlocks(streamerId, platform) }
  }

  /** The streamer's block list on one platform, newest first. */
  async listBlocks(streamerId: string, platform: string): Promise<StreamerBlock[]> {
    const rows = await this.sql.all(blocksOfStreamerSql, [streamerId, platform])
    return rows.map((row) => {
      const reader = new RowReader("streamer_blocks", row)
      return {
        platform: reader.text("platform"),
        platformUserId: reader.text("platform_user_id"),
        login: reader.text("login"),
        createdAt: reader.int("created_at"),
      }
    })
  }

  /**
   * Adds the block while the streamer holds fewer than `max`; a repeat keeps the first. The version
   * moves first: a lost insert after it only makes rooms reload an unchanged list, while the other
   * order could leave a block that no room is told to load.
   */
  async addBlock(streamerId: string, block: StreamerBlock, max: number): Promise<AddBlockOutcome> {
    await this.sql.run(bumpBlockListVersionSql, [streamerId])
    const inserted = await this.sql.all(insertBlockSql, [
      streamerId,
      block.platform,
      block.platformUserId,
      block.login,
      block.createdAt,
      streamerId,
      max,
    ])
    if (inserted.length === 1) return "added"
    const existing = await this.sql.all(blockSql, [
      streamerId,
      block.platform,
      block.platformUserId,
    ])
    return existing.length === 1 ? "exists" : "full"
  }

  /** Idempotent: removing a block that is not there changes only the version, as in {@link addBlock}. */
  async removeBlock(streamerId: string, platform: string, platformUserId: string): Promise<void> {
    await this.sql.run(bumpBlockListVersionSql, [streamerId])
    await this.sql.run(deleteBlockSql, [streamerId, platform, platformUserId])
  }

  /** Removes the giveaway's row with its moderator links, which frees its code; the caller deletes its room first. */
  async deleteGiveaway(giveawayId: string): Promise<void> {
    await this.sql.batch([
      { sql: deleteGiveawayModeratorLinksSql, params: [giveawayId] },
      { sql: deleteGiveawaySql, params: [giveawayId] },
    ])
  }

  /** Removes the streamer with their token, block list, every giveaway row and its moderator links in one batch; the caller deletes the rooms first. */
  async deleteStreamer(streamerId: string): Promise<void> {
    await this.sql.batch([
      { sql: deleteStreamerModeratorLinksSql, params: [streamerId] },
      { sql: deleteStreamerBlocksSql, params: [streamerId] },
      { sql: deleteStreamerGiveawaysSql, params: [streamerId] },
      { sql: deleteStreamerTokenSql, params: [streamerId] },
      { sql: deleteStreamerSql, params: [streamerId] },
    ])
  }

  /** Ids of up to `limit` drawn giveaways that closed before `closedBefore`, earliest close first. */
  async listExpiredGiveaways(closedBefore: Instant, limit: number): Promise<string[]> {
    const rows = await this.sql.all(expiredGiveawaysSql, [closedBefore, limit])
    return rows.map((row) => new RowReader("giveaways", row).text("id"))
  }

  /** Idempotent mirror of the room's status; the first status past open also stores `at` as the close time. */
  async setStatus(giveawayId: string, status: RoomStatus, at: Instant): Promise<void> {
    await this.sql.run(setStatusSql, [status, status === "open" ? null : at, giveawayId])
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

  /** The streamer's overlay theme; the default while none is stored. */
  async streamerOverlayTheme(streamerId: string): Promise<OverlayTheme> {
    const [row] = await this.sql.all(streamerOverlaySql, [streamerId])
    return row === undefined
      ? defaultOverlayTheme
      : storedTheme(
          new RowReader("streamer_overlay", row).text("theme_json"),
          "streamer_overlay",
          "theme_json",
        )
  }

  /** Idempotent: the row keeps only the latest theme. */
  async storeStreamerOverlayTheme(
    streamerId: string,
    theme: OverlayTheme,
    at: Instant,
  ): Promise<void> {
    await this.sql.run(storeStreamerOverlaySql, [streamerId, JSON.stringify(theme), at])
  }

  /** Ids of the streamer's giveaways not drawn yet that show the streamer's theme, whose overlays a new one reaches. */
  async streamerThemedGiveaways(streamerId: string): Promise<string[]> {
    const rows = await this.sql.all(streamerThemedGiveawaysSql, [streamerId])
    return rows.map((row) => new RowReader("giveaways", row).text("id"))
  }

  /** Null when the giveaway is not this streamer's. */
  async ownedOverlayThemes(
    streamerId: string,
    giveawayId: string,
  ): Promise<OwnedOverlayThemes | null> {
    const [row] = await this.sql.all(ownedOverlayThemesSql, [giveawayId, streamerId])
    return row === undefined ? null : overlayThemesOf(row)
  }

  /** What the giveaway's overlay shows: its own theme, else its streamer's, else the default. Not owner-scoped: the caller checked the overlay token. */
  async overlayThemeOf(giveawayId: string): Promise<OverlayTheme> {
    const [row] = await this.sql.all(overlayThemesSql, [giveawayId])
    if (row === undefined) return defaultOverlayTheme
    const themes = overlayThemesOf(row)
    return themes.own ?? themes.streamer
  }

  /** A null theme gives the giveaway back its streamer's. False when the giveaway is not this streamer's. */
  async setGiveawayOverlayTheme(
    streamerId: string,
    giveawayId: string,
    theme: OverlayTheme | null,
  ): Promise<boolean> {
    const json = theme === null ? null : JSON.stringify(theme)
    return (await this.sql.all(setGiveawayOverlaySql, [json, giveawayId, streamerId])).length === 1
  }

  async insertModeratorLink(link: NewModeratorLink): Promise<void> {
    await this.sql.run(insertModeratorLinkSql, [
      link.id,
      link.streamerId,
      link.giveawayId,
      link.tokenHash,
      link.requireMod ? 1 : 0,
      link.createdAt,
    ])
  }

  /** The giveaway's links that still work, oldest first; another streamer's giveaway lists none. */
  async listModeratorLinks(streamerId: string, giveawayId: string): Promise<ModeratorLink[]> {
    const rows = await this.sql.all(activeModeratorLinksSql, [giveawayId, streamerId])
    return rows.map(parseModeratorLink)
  }

  /** Revoked links are found too: the caller refuses them. */
  async findModeratorLink(id: string): Promise<ModeratorLink | null> {
    const [row] = await this.sql.all(moderatorLinkByIdSql, [id])
    return row === undefined ? null : parseModeratorLink(row)
  }

  /** Idempotent: an earlier revocation keeps its time. False when the streamer's giveaway has no such link. */
  async revokeModeratorLink(
    streamerId: string,
    giveawayId: string,
    linkId: string,
    at: Instant,
  ): Promise<boolean> {
    const rows = await this.sql.all(revokeModeratorLinkSql, [at, linkId, giveawayId, streamerId])
    return rows.length === 1
  }

  private async findOne(sql: string, params: readonly string[]): Promise<Giveaway | null> {
    const [row] = await this.sql.all(sql, params)
    return row === undefined ? null : this.parseGiveaway(row)
  }

  private parseGiveaway(row: SqlRow): Giveaway {
    const reader = new RowReader("giveaways", row)
    const rules = parseRules(
      parseJsonColumn(reader.text("rules_json"), "giveaways", "rules_json"),
      this.config,
    )
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
      blockListVersion: reader.int("block_list_version"),
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

function parseModeratorLink(row: SqlRow): ModeratorLink {
  const reader = new RowReader("moderator_links", row)
  return {
    id: reader.text("id"),
    streamerId: reader.text("streamer_id"),
    giveawayId: reader.text("giveaway_id"),
    tokenHash: reader.text("token_hash"),
    requireMod: reader.int("require_mod") === 1,
    createdAt: reader.int("created_at"),
    revokedAt: reader.nullableInt("revoked_at"),
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

// The query names `streamer_overlay.theme_json` `streamer_theme_json`; an error names the table's own column.
function overlayThemesOf(row: SqlRow): OwnedOverlayThemes {
  const reader = new RowReader("giveaways", row)
  const own = reader.nullableText("overlay_theme_json")
  const streamer = reader.nullableText("streamer_theme_json")
  return {
    own: own === null ? null : storedTheme(own, "giveaways", "overlay_theme_json"),
    streamer:
      streamer === null
        ? defaultOverlayTheme
        : storedTheme(streamer, "streamer_overlay", "theme_json"),
  }
}

/** The text of a theme column, which must hold a valid theme. */
function storedTheme(text: string, table: string, column: string): OverlayTheme {
  const theme = parseOverlayTheme(parseJsonColumn(text, table, column))
  if (!theme.ok) throw new RoomRowError(table, column)
  return theme.value
}

function parseJsonColumn(text: string, table: string, column: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new RoomRowError(table, column)
  }
}
