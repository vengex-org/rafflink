-- Set once the retention sweep woke the room of a closed giveaway, so the room armed its deletion alarm and the sweep never picks it again.
ALTER TABLE giveaways ADD COLUMN retention_armed INTEGER NOT NULL DEFAULT 0 CHECK (retention_armed IN (0, 1));

CREATE INDEX giveaways_retention_unarmed ON giveaways (created_at, id) WHERE retention_armed = 0;
