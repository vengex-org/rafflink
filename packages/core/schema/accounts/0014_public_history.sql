-- 1: the streamer's public history page lists their drawn giveaways. Off until the streamer turns it on.
ALTER TABLE streamers ADD COLUMN public_history INTEGER NOT NULL DEFAULT 0 CHECK (public_history IN (0, 1));

-- 1: the streamer keeps this giveaway off their public history page.
ALTER TABLE giveaways ADD COLUMN hidden_from_history INTEGER NOT NULL DEFAULT 0 CHECK (hidden_from_history IN (0, 1));

-- The public history page finds the streamer by the login in its address, and takes the newest row when an old row still holds a login its account gave up.
CREATE INDEX streamers_by_login ON streamers (platform, login, created_at);
