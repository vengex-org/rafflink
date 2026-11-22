/** Parameters: the oldest minute to keep (epoch milliseconds). */
export const pruneMinutesSql = "DELETE FROM metrics_minute WHERE minute < ?"

/** The minutes from an instant (parameter 1), oldest first. */
export const minutesSinceSql =
  "SELECT minute, entries, claims FROM metrics_minute WHERE minute >= ? ORDER BY minute"

/**
 * Counts one visit of a source on a day (parameters: day, source, day, source, day, most sources per day,
 * day, most visits per day) and returns the source when it wrote. A source that has no row yet is ignored
 * once the day holds the most sources it may, and nothing is written once the day's visits reached the most.
 */
export const countReferralSql = `INSERT INTO referrals (day, ref, count)
  SELECT ?, ?, 1
  WHERE (EXISTS (SELECT 1 FROM referrals WHERE day = ? AND ref = ?)
      OR (SELECT COUNT(*) FROM referrals WHERE day = ?) < ?)
    AND (SELECT COALESCE(SUM(count), 0) FROM referrals WHERE day = ?) < ?
  ON CONFLICT (day, ref) DO UPDATE SET count = count + 1
  RETURNING ref`

/** Parameters: the first day to keep (days since 1970-01-01). */
export const pruneReferralsSql = "DELETE FROM referrals WHERE day < ?"

/** The busiest sources from a day (parameter 1) on. Parameter 2: how many. */
export const topReferralsSql = `SELECT ref, SUM(count) AS visits FROM referrals WHERE day >= ?
  GROUP BY ref ORDER BY visits DESC, ref LIMIT ?`

/** Giveaways created per UTC day from an instant (parameter 1) on; `day` is days since 1970-01-01. */
export const giveawaysPerDaySql = `SELECT created_at / 86400000 AS day, COUNT(*) AS c FROM giveaways
  WHERE created_at >= ? GROUP BY day ORDER BY day`

/** Streamers first seen per UTC day from an instant (parameter 1) on. */
export const streamersPerDaySql = `SELECT created_at / 86400000 AS day, COUNT(*) AS c FROM streamers
  WHERE created_at >= ? GROUP BY day ORDER BY day`

/** Streamers whose second giveaway came at most a number of milliseconds (parameter 1) after their first. */
export const returningStreamersSql = `WITH ranked AS (
    SELECT streamer_id, created_at,
      ROW_NUMBER() OVER (PARTITION BY streamer_id ORDER BY created_at, id) AS n
    FROM giveaways
  )
  SELECT COUNT(*) AS c FROM ranked second JOIN ranked first ON first.streamer_id = second.streamer_id
  WHERE first.n = 1 AND second.n = 2 AND second.created_at - first.created_at <= ?`

/** The giveaways whose entries are open, newest first. Parameter 1: how many. */
export const openGiveawaysSql = `SELECT g.id, g.code, g.title, g.closes_at, s.display_name AS streamer_name
  FROM giveaways g JOIN streamers s ON s.id = g.streamer_id
  WHERE g.status = 'open' ORDER BY g.created_at DESC, g.id DESC LIMIT ?`

export const openGiveawayCountSql = "SELECT COUNT(*) AS c FROM giveaways WHERE status = 'open'"
