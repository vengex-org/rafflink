-- Streamer accounts, their sealed refresh tokens and the giveaway list.

CREATE TABLE streamers (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (platform, platform_user_id)
);

CREATE TABLE streamer_tokens (
  streamer_id TEXT PRIMARY KEY REFERENCES streamers (id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  scopes TEXT NOT NULL,
  validated_at INTEGER NOT NULL
);

CREATE TABLE giveaways (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  streamer_id TEXT NOT NULL REFERENCES streamers (id),
  title TEXT,
  prize TEXT,
  rules_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'drawn')),
  closes_at INTEGER,
  claim_seconds INTEGER NOT NULL CHECK (claim_seconds > 0),
  overlay_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX giveaways_by_streamer ON giveaways (streamer_id, created_at, id);
