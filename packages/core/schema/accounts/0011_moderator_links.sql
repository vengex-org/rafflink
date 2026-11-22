-- Links a streamer hands to a moderator for one giveaway: whoever opens one may close entries, draw, reroll and mark claims. Only the SHA-256 hex of the link's token is stored. Revoking sets revoked_at, and from then on the link answers 403. Rows go with their giveaway, which the account store deletes in the same batch.
CREATE TABLE moderator_links (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL REFERENCES streamers (id),
  giveaway_id TEXT NOT NULL REFERENCES giveaways (id),
  token_hash TEXT NOT NULL UNIQUE,
  -- 1: the opener must be signed in as a moderator (or the broadcaster) of the giveaway's channel.
  require_mod INTEGER NOT NULL CHECK (require_mod IN (0, 1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

-- The live page lists a giveaway's links, and deleting a giveaway or a streamer deletes them by giveaway.
CREATE INDEX moderator_links_by_giveaway ON moderator_links (giveaway_id, created_at, id);
