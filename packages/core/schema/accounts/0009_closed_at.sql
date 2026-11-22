-- When the account store first learned that the giveaway is no longer open (epoch milliseconds, UTC), NULL while it is open. HISTORY_RETENTION_DAYS counts from it. A giveaway closed before this column existed gets its creation time.
ALTER TABLE giveaways ADD COLUMN closed_at INTEGER;

UPDATE giveaways SET closed_at = created_at WHERE status != 'open';

-- The history retention sweep lists drawn giveaways by close time.
CREATE INDEX giveaways_drawn_by_closed ON giveaways (closed_at, id) WHERE status = 'drawn';
