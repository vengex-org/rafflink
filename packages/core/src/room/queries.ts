/** Entries since a time (parameter 1), for the entries per second of the live page. */
export const recentEntriesCountSql = "SELECT COUNT(*) AS c FROM entries WHERE entered_at >= ?"

/** The newest entrants (parameter 1 is how many), newest first. */
export const lastNamesSql =
  "SELECT display_name FROM entries ORDER BY entered_at DESC, platform DESC, platform_user_id DESC LIMIT ?"
