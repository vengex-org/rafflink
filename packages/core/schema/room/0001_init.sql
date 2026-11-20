-- One giveaway room: one room_state row, its entries, the channel role lists and the draw picks.

CREATE TABLE room_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  platform TEXT NOT NULL,
  giveaway_id TEXT NOT NULL,
  broadcaster_id TEXT NOT NULL,
  title TEXT,
  code TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  claim_seconds INTEGER NOT NULL CHECK (claim_seconds > 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'drawn')),
  closes_at INTEGER,
  seed BLOB,
  entrant_count INTEGER NOT NULL DEFAULT 0,
  ticket_total INTEGER NOT NULL DEFAULT 0,
  role_refresh_failures INTEGER NOT NULL DEFAULT 0,
  eventsub_failures INTEGER NOT NULL DEFAULT 0,
  chat_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (chat_unavailable IN (0, 1)),
  roles_refresh_at INTEGER,
  mirror_pending INTEGER NOT NULL DEFAULT 0 CHECK (mirror_pending IN (0, 1)),
  CHECK ((status = 'drawn') = (seed IS NOT NULL))
);

CREATE TABLE entries (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('viewer', 'follower', 'sub_t1', 'sub_t2', 'sub_t3', 'vip', 'moderator')),
  tickets INTEGER NOT NULL CHECK (tickets > 0),
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (platform, platform_user_id)
) WITHOUT ROWID;

CREATE INDEX entries_by_entered_at ON entries (entered_at, platform, platform_user_id);

CREATE TABLE channel_roles (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('vip', 'moderator')),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform, platform_user_id, role)
) WITHOUT ROWID;

CREATE TABLE draws (
  n INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  drawn_at INTEGER NOT NULL,
  claim_until INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_via TEXT CHECK (claimed_via IN ('rafflink', 'chat', 'manual')),
  rerolled INTEGER NOT NULL DEFAULT 0 CHECK (rerolled IN (0, 1)),
  CHECK ((claimed_at IS NULL) = (claimed_via IS NULL))
);

CREATE UNIQUE INDEX draws_by_entrant ON draws (platform, platform_user_id);

CREATE INDEX draws_waiting ON draws (claim_until) WHERE claimed_at IS NULL AND rerolled = 0
