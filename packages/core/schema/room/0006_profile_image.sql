-- The entrant's Twitch profile picture URL, shown in the streamer's entrants table and winner card. Nullable: an entry written before this migration, or whose picture was not on Twitch's image host, has none.
ALTER TABLE entries ADD COLUMN profile_image_url TEXT;
