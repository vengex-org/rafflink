-- The drain rate adapts to 429s: it grows by a step per interval counted from `rate_changed_at`, and a 429 on
-- the direct path is measured from the entries the giveaway's room wrote just before it.

ALTER TABLE queue_stats ADD COLUMN rate_changed_at INTEGER NOT NULL DEFAULT 0;
-- The giveaway and the instant of a 429 on the direct path whose rate the next pass still has to measure.
-- Both NULL, or both set.
ALTER TABLE queue_stats ADD COLUMN measure_giveaway_id TEXT;
ALTER TABLE queue_stats ADD COLUMN measure_until INTEGER;
-- When the queue last went from idle to holding codes, and only the first 429 after it pauses the queue.
ALTER TABLE queue_stats ADD COLUMN backlog_started_at INTEGER NOT NULL DEFAULT 0;
-- One pass is the calls of one second. On Cloudflare it spreads over several alarm invocations.
-- `pass_started_at` is 0 before the first pass of a backlog.
ALTER TABLE queue_stats ADD COLUMN pass_started_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_stats ADD COLUMN pass_calls INTEGER NOT NULL DEFAULT 0;
