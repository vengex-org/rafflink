-- When an admin approved the streamer to create giveaways, and the Twitch user id of that admin. Both NULL while the account waits. Read only while OPEN_SIGNUP is false.
ALTER TABLE streamers ADD COLUMN approved_at INTEGER;
ALTER TABLE streamers ADD COLUMN approved_by TEXT;
