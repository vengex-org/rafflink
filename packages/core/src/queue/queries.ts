/** Deletes and returns the codes received before a cutoff (parameter 1) that are still queued. */
export const expiredQueuedSql =
  "DELETE FROM token_queue WHERE state = 'queued' AND received_at < ? RETURNING giveaway_id"

/** Deletes and returns the finished results received before a cutoff (parameter 1) that nobody polled. */
export const purgeDoneSql =
  "DELETE FROM token_queue WHERE state = 'done' AND received_at < ? RETURNING ticket"

/** The oldest queued codes first (parameter 1 is how many). */
export const nextQueuedSql = `SELECT ticket, code, giveaway_id, nonce FROM token_queue
  WHERE state = 'queued' ORDER BY received_at, ticket LIMIT ?`

/** One queued row, if any. */
export const oldestQueuedSql = "SELECT ticket FROM token_queue WHERE state = 'queued' LIMIT 1"

/** The oldest finished result, if any. */
export const oldestDoneSql = `SELECT received_at FROM token_queue WHERE state = 'done'
  ORDER BY received_at, ticket LIMIT 1`

export const statsSql =
  "SELECT rate_per_second, cooldown_until, dropped, abandoned_results FROM queue_stats WHERE id = 1"
