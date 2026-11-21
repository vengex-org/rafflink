-- How many sweeps woke the room of a closed giveaway and failed, so a room that always fails sorts behind the others and stops being tried at the configured limit.
ALTER TABLE giveaways ADD COLUMN retention_attempts INTEGER NOT NULL DEFAULT 0 CHECK (retention_attempts >= 0);

DROP INDEX giveaways_retention_unarmed;

CREATE INDEX giveaways_retention_unarmed ON giveaways (retention_attempts, created_at, id) WHERE retention_armed = 0 AND status != 'open';
