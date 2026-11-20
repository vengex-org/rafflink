const giveawayColumns = `g.id, g.code, g.streamer_id, s.platform, s.platform_user_id AS broadcaster_id,
  g.title, g.prize, g.rules_json, g.status, g.closes_at, g.claim_seconds, g.overlay_token, g.created_at`
const giveawayFrom = "FROM giveaways g JOIN streamers s ON s.id = g.streamer_id"

/** A giveaway by its short code (parameter 1). */
export const giveawayByCodeSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.code = ?`

/** A giveaway by id (parameter 1). */
export const giveawayByIdSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.id = ?`

/** A giveaway by id (parameter 1) that belongs to a streamer (parameter 2). */
export const ownedGiveawaySql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.id = ? AND g.streamer_id = ?`

/** A streamer's giveaways (parameter 1), newest first. */
export const giveawaysOfStreamerSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.streamer_id = ? ORDER BY g.created_at DESC, g.id DESC`

/** Parameters: id, code, streamer id, title, prize, rules, closes at, claim seconds, overlay token, created at. */
export const insertGiveawaySql = `INSERT INTO giveaways
  (id, code, streamer_id, title, prize, rules_json, status, closes_at, claim_seconds, overlay_token, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
  ON CONFLICT (code) DO NOTHING
  RETURNING id`

/** Parameters: status, giveaway id. */
export const setStatusSql = "UPDATE giveaways SET status = ? WHERE id = ?"

/** Parameters: id, platform, platform user id, login, created at. */
export const upsertStreamerSql = `INSERT INTO streamers (id, platform, platform_user_id, login, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (platform, platform_user_id) DO UPDATE SET login = excluded.login`

/** Parameters: sealed token, scopes, validated at, platform, platform user id. */
export const upsertStreamerTokenSql = `INSERT INTO streamer_tokens (streamer_id, refresh_token_enc, scopes, validated_at)
  SELECT id, ?, ?, ? FROM streamers WHERE platform = ? AND platform_user_id = ?
  ON CONFLICT (streamer_id) DO UPDATE SET
    refresh_token_enc = excluded.refresh_token_enc,
    scopes = excluded.scopes,
    validated_at = excluded.validated_at`

/** Parameters: platform, platform user id. */
export const streamerByPlatformUserSql =
  "SELECT id, platform, platform_user_id, login FROM streamers WHERE platform = ? AND platform_user_id = ?"
