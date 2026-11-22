-- How a streamer's OBS overlay looks, one row at most per streamer. No row: the default look. theme_json is parsed by parseOverlayTheme.
CREATE TABLE streamer_overlay (
  streamer_id TEXT PRIMARY KEY REFERENCES streamers (id) ON DELETE CASCADE,
  theme_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A look for one giveaway's overlay in place of the streamer's. NULL: the streamer's look applies.
ALTER TABLE giveaways ADD COLUMN overlay_theme_json TEXT;
