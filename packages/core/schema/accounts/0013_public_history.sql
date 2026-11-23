-- 1: the streamer's public history page lists their drawn giveaways. Off until the streamer turns it on.
ALTER TABLE streamers ADD COLUMN public_history INTEGER NOT NULL DEFAULT 0 CHECK (public_history IN (0, 1));

-- The last sign-in that stored the login (epoch milliseconds, UTC). A renamed account keeps its old login until it signs in again, so the public history page takes the row that saw the login last. A streamer from before this column gets the first sign-in.
ALTER TABLE streamers ADD COLUMN login_seen_at INTEGER NOT NULL DEFAULT 0;

UPDATE streamers SET login_seen_at = created_at;

CREATE INDEX streamers_by_login ON streamers (platform, login, login_seen_at);

-- 1: the streamer keeps this giveaway off their public history page.
ALTER TABLE giveaways ADD COLUMN hidden_from_history INTEGER NOT NULL DEFAULT 0 CHECK (hidden_from_history IN (0, 1));

-- The room's entrant count and its picks that were not rerolled, copied with the status by the mirror, so the public history reads no room. NULL until the room mirrors them.
ALTER TABLE giveaways ADD COLUMN entrant_count INTEGER CHECK (entrant_count >= 0);
ALTER TABLE giveaways ADD COLUMN winners INTEGER CHECK (winners >= 0);

-- The public history lists a streamer's shown drawn giveaways by close time, newest first.
CREATE INDEX giveaways_public_history ON giveaways (streamer_id, closed_at, id)
  WHERE status = 'drawn' AND hidden_from_history = 0 AND entrant_count IS NOT NULL;
