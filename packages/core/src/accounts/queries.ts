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

/** Parameters: status, the close time to keep unless one is stored (NULL for open), giveaway id. */
export const setStatusSql =
  "UPDATE giveaways SET status = ?, closed_at = COALESCE(closed_at, ?) WHERE id = ?"

/** Ids of giveaways the room reported as no longer open and the retention sweep has not woken yet, fewest failed sweeps first, then oldest. Parameters: attempts below which a giveaway is tried, how many. */
export const unarmedRetentionSql =
  "SELECT id FROM giveaways WHERE retention_armed = 0 AND status != 'open' AND retention_attempts < ? ORDER BY retention_attempts, created_at, id LIMIT ?"

/** Parameters: giveaway id. Returns the new count of failed sweeps. */
export const recordRetentionFailureSql =
  "UPDATE giveaways SET retention_attempts = retention_attempts + 1 WHERE id = ? RETURNING retention_attempts"

/** A giveaway id (parameter 1). */
export const setRetentionArmedSql = "UPDATE giveaways SET retention_armed = 1 WHERE id = ?"

/** Ids of drawn giveaways that closed before an instant (parameter 1), earliest close first; parameter 2 is how many. */
export const expiredGiveawaysSql =
  "SELECT id FROM giveaways WHERE status = 'drawn' AND closed_at < ? ORDER BY closed_at, id LIMIT ?"

/** A giveaway id (parameter 1); its room is deleted separately. */
export const deleteGiveawaySql = "DELETE FROM giveaways WHERE id = ?"

/** The giveaways of a streamer (parameter 1); deleted before the streamer, whom they reference. */
export const deleteStreamerGiveawaysSql = "DELETE FROM giveaways WHERE streamer_id = ?"

/** A streamer by id (parameter 1), once their giveaways and token are gone. */
export const deleteStreamerSql = "DELETE FROM streamers WHERE id = ?"

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

const streamerColumns =
  "id, platform, platform_user_id, login, display_name, profile_image_url, created_at, approved_at"

/** Parameters: platform, platform user id. */
export const streamerByPlatformUserSql = `SELECT ${streamerColumns} FROM streamers WHERE platform = ? AND platform_user_id = ?`

/** A streamer by id (parameter 1). */
export const streamerByIdSql = `SELECT ${streamerColumns} FROM streamers WHERE id = ?`

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

/** Streamers an admin has not approved, newest sign-up first. Parameter 1: how many. */
export const pendingStreamersSql = `SELECT ${streamerColumns} FROM streamers WHERE approved_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`

/** Streamers an admin approved, latest approval first. Parameter 1: how many. */
export const approvedStreamersSql = `SELECT ${streamerColumns} FROM streamers WHERE approved_at IS NOT NULL ORDER BY approved_at DESC, created_at DESC, id DESC LIMIT ?`

/** Parameters: approved at, approved by (the admin's Twitch user id), streamer id. Keeps an earlier approval; returns the id when the streamer exists. */
export const approveStreamerSql = `UPDATE streamers SET approved_at = COALESCE(approved_at, ?), approved_by = COALESCE(approved_by, ?) WHERE id = ? RETURNING id`

/** A streamer id (parameter 1); returns it when the streamer exists. */
export const revokeStreamerSql =
  "UPDATE streamers SET approved_at = NULL, approved_by = NULL WHERE id = ? RETURNING id"
