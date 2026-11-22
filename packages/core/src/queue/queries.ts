/** Deletes and returns the codes received before a cutoff (parameter 1) that are still queued. */
export const expiredQueuedSql =
  "DELETE FROM token_queue WHERE state = 'queued' AND received_at < ? RETURNING giveaway_id"

/** Deletes the finished results received before a cutoff (parameter 1); `polled` says whether the browser got it. */
export const purgeDoneSql =
  "DELETE FROM token_queue WHERE state = 'done' AND received_at < ? RETURNING polled"

/** Returns the rows claimed before a cutoff (parameter 1) to the queue: their pass never reported. */
export const releaseStaleSql = `UPDATE token_queue SET state = 'queued', claimed_at = NULL
  WHERE state = 'processing' AND claimed_at < ? RETURNING giveaway_id`

/**
 * Claims the oldest queued codes (parameter 1 is the claim time, parameter 2 how many) and returns them.
 * A second pass finds them `processing` and leaves them alone.
 */
export const claimQueuedSql = `UPDATE token_queue SET state = 'processing', claimed_at = ?
  WHERE ticket IN (
    SELECT ticket FROM token_queue WHERE state = 'queued' ORDER BY received_at, ticket LIMIT ?
  )
  RETURNING ticket, code, giveaway_id, nonce`

/** Returns one claimed row to the queue (parameters: ticket, claim time); no row comes back when the claim was lost. */
export const requeueClaimedSql = `UPDATE token_queue SET state = 'queued', claimed_at = NULL
  WHERE ticket = ? AND state = 'processing' AND claimed_at = ? RETURNING ticket`

/** Stores the result of one claimed row (parameters: result, user, ticket, claim time); no row comes back when the claim was lost. */
export const finishClaimedSql = `UPDATE token_queue SET state = 'done', claimed_at = NULL, result_json = ?, user_id = ?
  WHERE ticket = ? AND state = 'processing' AND claimed_at = ? RETURNING ticket`

/** One queued row, if any. */
export const oldestQueuedSql = "SELECT ticket FROM token_queue WHERE state = 'queued' LIMIT 1"

/** The time of the oldest claim; NULL when no row is claimed. */
export const oldestClaimSql =
  "SELECT MIN(claimed_at) AS claimed_at FROM token_queue WHERE state = 'processing'"

/** The oldest finished result, if any. */
export const oldestDoneSql = `SELECT received_at FROM token_queue WHERE state = 'done'
  ORDER BY received_at, ticket LIMIT 1`

/** The codes waiting or being processed. */
export const waitingCountSql =
  "SELECT COUNT(*) AS c FROM token_queue WHERE state IN ('queued', 'processing')"

export const statsSql = `SELECT rate_per_second, rate_changed_at, cooldown_until, measure_giveaway_id, measure_until,
  backlog_started_at, pass_started_at, pass_calls, dropped, abandoned_results, lost_claims,
  rate_limited_total, last_rate_limited_at
  FROM queue_stats WHERE id = 1`

/** Adds 429s to a minute (parameters: start of the minute, how many). */
export const addRateLimitedMinuteSql = `INSERT INTO rate_limited_minute (minute, count) VALUES (?, ?)
  ON CONFLICT (minute) DO UPDATE SET count = count + excluded.count`

/** Deletes the minutes before a cutoff (parameter 1). */
export const pruneRateLimitedMinutesSql = "DELETE FROM rate_limited_minute WHERE minute < ?"

/** Every minute that had a 429, oldest first. */
export const rateLimitedMinutesSql = "SELECT minute, count FROM rate_limited_minute ORDER BY minute"
