const giveawayColumns = `g.id, g.code, g.streamer_id, s.platform, s.platform_user_id AS broadcaster_id, s.display_name AS streamer_name,
  g.title, g.prize, g.rules_json, g.status, g.closes_at, g.claim_seconds, g.winner_count, g.overlay_token, g.created_at`
const giveawayFrom = "FROM giveaways g JOIN streamers s ON s.id = g.streamer_id"

/** A giveaway by its short code (parameter 1). */
export const giveawayByCodeSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.code = ?`

/** A giveaway by id (parameter 1). */
export const giveawayByIdSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.id = ?`

/** A giveaway by id (parameter 1) that belongs to a streamer (parameter 2). */
export const ownedGiveawaySql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.id = ? AND g.streamer_id = ?`

/** A streamer's giveaways (parameter 1), newest first. */
export const giveawaysOfStreamerSql = `SELECT ${giveawayColumns} ${giveawayFrom} WHERE g.streamer_id = ? ORDER BY g.created_at DESC, g.id DESC`

/** Parameters: id, code, streamer id, title, prize, rules, closes at, claim seconds, winner count, overlay token, created at. */
export const insertGiveawaySql = `INSERT INTO giveaways
  (id, code, streamer_id, title, prize, rules_json, status, closes_at, claim_seconds, winner_count, overlay_token, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  ON CONFLICT (code) DO NOTHING
  RETURNING id`

/** Parameters: status, giveaway id. */
export const setStatusSql = "UPDATE giveaways SET status = ? WHERE id = ?"

/** Ids of giveaways the room reported as no longer open and the retention sweep has not woken yet, fewest failed sweeps first, then oldest. Parameters: attempts below which a giveaway is tried, how many. */
export const unarmedRetentionSql =
  "SELECT id FROM giveaways WHERE retention_armed = 0 AND status != 'open' AND retention_attempts < ? ORDER BY retention_attempts, created_at, id LIMIT ?"

/** Parameters: giveaway id. Returns the new count of failed sweeps. */
export const recordRetentionFailureSql =
  "UPDATE giveaways SET retention_attempts = retention_attempts + 1 WHERE id = ? RETURNING retention_attempts"

/** A giveaway id (parameter 1). */
export const setRetentionArmedSql = "UPDATE giveaways SET retention_armed = 1 WHERE id = ?"

/** Parameters: id, platform, platform user id, login, display name, profile image URL, created at. */
export const upsertStreamerSql = `INSERT INTO streamers (id, platform, platform_user_id, login, display_name, profile_image_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (platform, platform_user_id) DO UPDATE SET
    login = excluded.login,
    display_name = excluded.display_name,
    profile_image_url = excluded.profile_image_url`

/** Parameters: sealed token, scopes, validated at, platform, platform user id. */
export const upsertStreamerTokenSql = `INSERT INTO streamer_tokens (streamer_id, refresh_token_enc, scopes, validated_at)
  SELECT id, ?, ?, ? FROM streamers WHERE platform = ? AND platform_user_id = ?
  ON CONFLICT (streamer_id) DO UPDATE SET
    refresh_token_enc = excluded.refresh_token_enc,
    scopes = excluded.scopes,
    validated_at = excluded.validated_at`

/** Parameters: platform, platform user id. */
export const streamerByPlatformUserSql =
  "SELECT id, platform, platform_user_id, login, display_name, profile_image_url FROM streamers WHERE platform = ? AND platform_user_id = ?"

/** A streamer by id (parameter 1). */
export const streamerByIdSql =
  "SELECT id, platform, platform_user_id, login, display_name, profile_image_url FROM streamers WHERE id = ?"

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

/** The plan an admin switched to; no row when nobody has. */
export const cloudflarePlanSql = "SELECT plan FROM cloudflare_plan WHERE id = 1"

/** Parameters: plan, changed at, changed by (the admin's Twitch user id). */
export const storeCloudflarePlanSql = `INSERT INTO cloudflare_plan (id, plan, changed_at, changed_by) VALUES (1, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    plan = excluded.plan,
    changed_at = excluded.changed_at,
    changed_by = excluded.changed_by`
