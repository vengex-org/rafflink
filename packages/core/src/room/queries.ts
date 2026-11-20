/** Entries since a time (parameter 1), for the entries per second of the live page. */
export const recentEntriesCountSql = "SELECT COUNT(*) AS c FROM entries WHERE entered_at >= ?"

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

/** Entrants after a sequence number (parameter 1), oldest first (parameter 2 is how many). */
export const entrantsAfterSql = `SELECT seq, login, display_name, group_name, tickets FROM entries
  WHERE seq > ? ORDER BY seq LIMIT ?`

/** The sequence number of the newest entry; `head` is NULL when nobody entered. */
export const headSeqSql = "SELECT MAX(seq) AS head FROM entries"
