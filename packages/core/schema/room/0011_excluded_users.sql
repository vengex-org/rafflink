-- Accounts that may not enter: the streamer's block list ('blocked', replaced at every edit of the list) and the winners of the streamer's recent giveaways ('recent-winner', written when the room is set up). Personal data, deleted with the entries.
CREATE TABLE excluded_users (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('blocked', 'recent-winner')),
  PRIMARY KEY (platform, platform_user_id, reason)
) WITHOUT ROWID;

-- 1 once the excluded accounts were written. Until then the room refuses entries and the caller writes them.
ALTER TABLE room_state ADD COLUMN exclusions_loaded INTEGER NOT NULL DEFAULT 0 CHECK (exclusions_loaded IN (0, 1));

-- The streamers.block_list_version the blocked rows hold. An older list never replaces a newer one, and an entry that expects a newer one waits until the caller sends it.
ALTER TABLE room_state ADD COLUMN block_list_version INTEGER NOT NULL DEFAULT 0 CHECK (block_list_version >= 0);

-- Entries removed because their account was blocked while entries were open. entrant_count keeps counting every entry ever written, because it numbers the next seq, so the entrant count is entrant_count minus this.
ALTER TABLE room_state ADD COLUMN removed_entrants INTEGER NOT NULL DEFAULT 0 CHECK (removed_entrants >= 0);
