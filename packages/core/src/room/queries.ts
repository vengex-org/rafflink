/** Entries since a time (parameter 1), for the entries per second of the live page. */
export const recentEntriesCountSql = "SELECT COUNT(*) AS c FROM entries WHERE entered_at >= ?"

/** The entries written from one instant (parameter 1) up to but not including another (parameter 2). */
export const entriesBetweenCountSql =
  "SELECT COUNT(*) AS c FROM entries WHERE entered_at >= ? AND entered_at < ?"

/** The entry of an account (parameters: platform, platform user id). */
export const entryOfSql =
  "SELECT group_name, tickets, entered_at FROM entries WHERE platform = ? AND platform_user_id = ?"

/** The newest entrants (parameter 1 is how many), newest first. */
export const lastNamesSql =
  "SELECT display_name FROM entries ORDER BY entered_at DESC, platform DESC, platform_user_id DESC LIMIT ?"

/** The soonest claim deadline among picks that may still claim (parameter 1 is now); one row, `deadline` is NULL when none waits. */
export const nextClaimDeadlineSql =
  "SELECT MIN(claim_until) AS deadline FROM draws WHERE claimed_at IS NULL AND rerolled = 0 AND claim_until >= ?"

/** The latest claim deadline among picks that are neither claimed nor rerolled; `deadline` is NULL when none is left. */
export const lastClaimDeadlineSql =
  "SELECT MAX(claim_until) AS deadline FROM draws WHERE claimed_at IS NULL AND rerolled = 0"

/** The latest claim deadline among picks that are not rerolled, claimed ones included; `deadline` is NULL when none is left. */
export const lastStandingDeadlineSql =
  "SELECT MAX(claim_until) AS deadline FROM draws WHERE rerolled = 0"

/** One entrant who was never picked, so a reroll has someone to pick; no row when every entrant was drawn. */
export const undrawnEntrantSql = `SELECT 1 FROM entries e WHERE NOT EXISTS (
  SELECT 1 FROM draws d WHERE d.platform = e.platform AND d.platform_user_id = e.platform_user_id
) LIMIT 1`

/** The pick of a chatter (parameter 1) that may still claim (parameter 2 is now). */
export const waitingPickOfChatterSql = `SELECT n FROM draws
  WHERE platform = (SELECT platform FROM room_state WHERE id = 1)
    AND platform_user_id = ? AND claimed_at IS NULL AND rerolled = 0 AND claim_until >= ?`

/** The entry name (`display_name`) of a chatter (parameter 1) who holds a pick that is not rerolled; no row for anyone else. */
export const winnerChatNameSql = `SELECT e.display_name FROM draws d
  JOIN entries e ON e.platform = d.platform AND e.platform_user_id = d.platform_user_id
  WHERE d.platform = (SELECT platform FROM room_state WHERE id = 1)
    AND d.platform_user_id = ? AND d.rerolled = 0`

/** Entrants after a sequence number (parameter 1), oldest first (parameter 2 is how many). */
export const entrantsAfterSql = `SELECT seq, login, display_name, group_name, tickets, profile_image_url FROM entries
  WHERE seq > ? ORDER BY seq LIMIT ?`

/** Random entrant names (parameter 1 is how many), for the draw shuffle; the order carries no information about the draw. */
export const shuffleNamesSql = "SELECT display_name FROM entries ORDER BY RANDOM() LIMIT ?"

/** The sequence number of the newest entry; `head` is NULL when nobody entered. */
export const headSeqSql = "SELECT MAX(seq) AS head FROM entries"

/** One row while the room still holds personal data of entrants or channel roles; no row once it was deleted. */
export const retainedDataSql =
  "SELECT 1 AS present WHERE EXISTS (SELECT 1 FROM entries) OR EXISTS (SELECT 1 FROM channel_roles)"

/** Entries written per minute from one instant (parameter 1) up to but not including another (parameter 2); `minute` is the start of the minute. */
export const entriesPerMinuteSql = `SELECT entered_at / 60000 * 60000 AS minute, COUNT(*) AS c FROM entries
  WHERE entered_at >= ? AND entered_at < ? GROUP BY minute`

/** Claims made per minute in the same range. */
export const claimsPerMinuteSql = `SELECT claimed_at / 60000 * 60000 AS minute, COUNT(*) AS c FROM draws
  WHERE claimed_at >= ? AND claimed_at < ? GROUP BY minute`

/** Claims made since a time (parameter 1). */
export const claimsSinceCountSql = "SELECT COUNT(*) AS c FROM draws WHERE claimed_at >= ?"

/** The time of the first entry or claim at or after an instant (given twice, parameters 1 and 2); NULL when there is none. */
export const firstUnreportedActivitySql = `SELECT MIN(at) AS at FROM (
  SELECT MIN(entered_at) AS at FROM entries WHERE entered_at >= ?
  UNION ALL SELECT MIN(claimed_at) FROM draws WHERE claimed_at >= ?
)`
