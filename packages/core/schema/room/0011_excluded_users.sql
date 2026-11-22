-- Accounts that may not enter: the streamer's block list ('blocked', replaced at every edit of the list) and the winners of the streamer's recent giveaways ('recent-winner', written when the room is set up). Personal data, deleted with the entries.
CREATE TABLE excluded_users (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('blocked', 'recent-winner')),
  PRIMARY KEY (platform, platform_user_id, reason)
) WITHOUT ROWID;

-- 1 once the excluded accounts were written. Until then the app writes them at its next call to the room.
ALTER TABLE room_state ADD COLUMN exclusions_loaded INTEGER NOT NULL DEFAULT 0 CHECK (exclusions_loaded IN (0, 1));
