-- Subscriptions and channel point redemptions queue like the chat keyword, for the same profile and follow check. `via` says which way the request came. A sub request takes `sub_tier` from the subscription event, a points request has none and the check reads it.
ALTER TABLE chat_entry_requests ADD COLUMN via TEXT NOT NULL DEFAULT 'chat' CHECK (via IN ('chat', 'sub', 'points'));

-- 1 once Twitch refused the sub or points subscriptions of a watch that also reads chat: chat entry and claims go on, sub and points entry stop for the rest of the giveaway.
ALTER TABLE room_state ADD COLUMN channel_entry_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (channel_entry_unavailable IN (0, 1));

-- SQLite cannot widen the CHECK of `entries.via` in place, so the table is copied into one that also takes 'sub' and 'points'.
CREATE TABLE entries_next (
  seq INTEGER NOT NULL,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('viewer', 'follower', 'sub_t1', 'sub_t2', 'sub_t3', 'vip', 'moderator')),
  tickets INTEGER NOT NULL CHECK (tickets > 0),
  entered_at INTEGER NOT NULL,
  salt BLOB,
  profile_image_url TEXT,
  via TEXT NOT NULL DEFAULT 'page' CHECK (via IN ('page', 'chat', 'sub', 'points')),
  PRIMARY KEY (platform, platform_user_id)
) WITHOUT ROWID;

INSERT INTO entries_next (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at, salt, profile_image_url, via)
  SELECT seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at, salt, profile_image_url, via FROM entries;

DROP TABLE entries;

ALTER TABLE entries_next RENAME TO entries;

CREATE INDEX entries_by_entered_at ON entries (entered_at, platform, platform_user_id);

-- `seq` counts entries in the order they were written, from 1. The entrants table pages by it.
CREATE UNIQUE INDEX entries_by_seq ON entries (seq);

-- The "Am I in?" lookup of the giveaway page finds an entrant who never signed in on the page (chat, sub or points) by login. `via` in the key makes the index cover the lookup, which SQLite then prefers over the primary key.
CREATE INDEX channel_entries_by_login ON entries (platform, login, via) WHERE via <> 'page';
