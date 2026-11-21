const giveawayColumns = `g.id, g.code, g.streamer_id, s.platform, s.platform_user_id AS broadcaster_id, s.display_name AS streamer_name,
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

/** Ids of giveaways the room reported as no longer open and the retention sweep has not woken yet, oldest first (parameter 1 is how many). */
export const unarmedRetentionSql =
  "SELECT id FROM giveaways WHERE retention_armed = 0 AND status != 'open' ORDER BY created_at, id LIMIT ?"

/** A giveaway id (parameter 1). */
export const setRetentionArmedSql = "UPDATE giveaways SET retention_armed = 1 WHERE id = ?"

/** Parameters: id, platform, platform user id, login, display name, created at. */
export const upsertStreamerSql = `INSERT INTO streamers (id, platform, platform_user_id, login, display_name, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (platform, platform_user_id) DO UPDATE SET login = excluded.login, display_name = excluded.display_name`

/** Parameters: sealed token, scopes, validated at, platform, platform user id. */
export const upsertStreamerTokenSql = `INSERT INTO streamer_tokens (streamer_id, refresh_token_enc, scopes, validated_at)
  SELECT id, ?, ?, ? FROM streamers WHERE platform = ? AND platform_user_id = ?
  ON CONFLICT (streamer_id) DO UPDATE SET
    refresh_token_enc = excluded.refresh_token_enc,
    scopes = excluded.scopes,
    validated_at = excluded.validated_at`

/** Parameters: platform, platform user id. */
export const streamerByPlatformUserSql =
  "SELECT id, platform, platform_user_id, login, display_name FROM streamers WHERE platform = ? AND platform_user_id = ?"

/** A streamer by id (parameter 1). */
export const streamerByIdSql =
  "SELECT id, platform, platform_user_id, login, display_name FROM streamers WHERE id = ?"

const streamerTokenSelect = `SELECT t.streamer_id, s.platform, s.platform_user_id, t.refresh_token_enc
  FROM streamer_tokens t JOIN streamers s ON s.id = t.streamer_id`

/** Every stored streamer token, in streamer id order. */
export const streamerTokensSql = `${streamerTokenSelect} ORDER BY t.streamer_id`

/** The stored token of a streamer (parameter 1). */
export const streamerTokenSql = `${streamerTokenSelect} WHERE t.streamer_id = ?`

/** Parameters: sealed token, validated at, streamer id. */
export const replaceStreamerTokenSql =
  "UPDATE streamer_tokens SET refresh_token_enc = ?, validated_at = ? WHERE streamer_id = ?"

/** The token of a streamer (parameter 1). */
export const deleteStreamerTokenSql = "DELETE FROM streamer_tokens WHERE streamer_id = ?"
