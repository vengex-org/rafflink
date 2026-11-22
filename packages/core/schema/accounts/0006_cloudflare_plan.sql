-- The Cloudflare Workers plan an admin switched to on the admin page, one row at most. No row: CLOUDFLARE_PLAN applies. changed_by is the Twitch user id of the admin who switched.
CREATE TABLE cloudflare_plan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plan TEXT NOT NULL CHECK (plan IN ('free', 'paid')),
  changed_at INTEGER NOT NULL,
  changed_by TEXT NOT NULL
);
