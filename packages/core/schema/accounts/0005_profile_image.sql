-- The streamer's Twitch profile picture URL, refreshed at every sign-in and shown in the header. Nullable: a streamer who has not signed in since this migration has none.
ALTER TABLE streamers ADD COLUMN profile_image_url TEXT;
