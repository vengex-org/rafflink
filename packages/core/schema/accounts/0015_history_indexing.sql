-- 1: search engines may index the streamer's public history page. Off until the streamer turns it on.
ALTER TABLE streamers ADD COLUMN history_indexed INTEGER NOT NULL DEFAULT 0 CHECK (history_indexed IN (0, 1));

-- The login a sign-in replaced with a new one, so a link to the public history page under the old login redirects to the new one. NULL until a sign-in sees a renamed account, and only the latest rename is kept.
ALTER TABLE streamers ADD COLUMN previous_login TEXT;

-- The redirect looks a renamed streamer up by the login they gave up, latest sign-in first.
CREATE INDEX streamers_by_previous_login ON streamers (platform, previous_login, login_seen_at)
  WHERE previous_login IS NOT NULL;
