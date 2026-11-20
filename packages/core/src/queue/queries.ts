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

export const statsSql =
  "SELECT rate_per_second, cooldown_until, dropped, abandoned_results, lost_claims FROM queue_stats WHERE id = 1"
