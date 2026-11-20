/** Entries since a time (parameter 1), for the entries per second of the live page. */
export const recentEntriesCountSql = "SELECT COUNT(*) AS c FROM entries WHERE entered_at >= ?"

/** The newest entrants (parameter 1 is how many), newest first. */
export const lastNamesSql =
  "SELECT display_name FROM entries ORDER BY entered_at DESC, platform DESC, platform_user_id DESC LIMIT ?"

/** The soonest claim deadline among picks that may still claim (parameter 1 is now); one row, `deadline` is NULL when none waits. */
export const nextClaimDeadlineSql =
  "SELECT MIN(claim_until) AS deadline FROM draws WHERE claimed_at IS NULL AND rerolled = 0 AND claim_until >= ?"

/** The pick of a chatter (parameter 1) that may still claim (parameter 2 is now). */
export const waitingPickOfChatterSql = `SELECT n FROM draws
  WHERE platform = (SELECT platform FROM room_state WHERE id = 1)
    AND platform_user_id = ? AND claimed_at IS NULL AND rerolled = 0 AND claim_until >= ?`
