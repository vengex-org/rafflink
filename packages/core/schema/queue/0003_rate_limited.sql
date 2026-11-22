-- Token endpoint 429s, for the admin page: the total, the time of the last one, and the count per minute.
ALTER TABLE queue_stats ADD COLUMN rate_limited_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_stats ADD COLUMN last_rate_limited_at INTEGER NOT NULL DEFAULT 0;

-- `minute` is the start of the minute, epoch milliseconds, UTC. The queue deletes rows older than METRICS_RETENTION_HOURS.
CREATE TABLE rate_limited_minute (
  minute INTEGER PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0)
) WITHOUT ROWID;
