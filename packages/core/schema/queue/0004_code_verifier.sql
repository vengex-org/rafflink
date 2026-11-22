-- The PKCE verifier the code exchange proves. Codes queued before this column carry an empty one, which Twitch ignores, and are dropped within QUEUE_CODE_MAX_AGE_SECONDS.
ALTER TABLE token_queue ADD COLUMN code_verifier TEXT NOT NULL DEFAULT '';
