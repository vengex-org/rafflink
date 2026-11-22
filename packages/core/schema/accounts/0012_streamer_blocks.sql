-- Accounts a streamer keeps out of every one of their giveaways. platform_user_id is looked up from the login when the block is saved, so a rename does not lift it. login is the name as it was then, for the dashboard. Personal data of the blocked person, deleted with the streamer.
CREATE TABLE streamer_blocks (
  streamer_id TEXT NOT NULL REFERENCES streamers (id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (streamer_id, platform, platform_user_id)
) WITHOUT ROWID;

-- Counts the edits of the block list. A room holds the version of the list it has, and an entry into a room behind it waits until the list is sent, so a room the edit did not reach still never lets a blocked account in.
ALTER TABLE streamers ADD COLUMN block_list_version INTEGER NOT NULL DEFAULT 0 CHECK (block_list_version >= 0);

-- A new giveaway reads the winners of the latest drawn giveaways of its streamer, newest first.
CREATE INDEX giveaways_drawn_by_streamer ON giveaways (streamer_id, created_at, id) WHERE status = 'drawn';
