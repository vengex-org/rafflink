-- Where the retry of a failed commitment stands, kept in the row because an idle Durable Object is evicted between two retries and would forget it.
ALTER TABLE room_state ADD COLUMN commit_attempts INTEGER NOT NULL DEFAULT 0 CHECK (commit_attempts >= 0);

ALTER TABLE room_state ADD COLUMN commit_retry_at INTEGER;

ALTER TABLE room_state ADD COLUMN commit_gave_up INTEGER NOT NULL DEFAULT 0 CHECK (commit_gave_up IN (0, 1));
