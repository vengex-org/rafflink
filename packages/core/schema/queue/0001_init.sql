-- The token queue of one deployment: authorization codes waiting for the token endpoint and the counters of the queue.

CREATE TABLE token_queue (
  ticket TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  giveaway_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'done')),
  result_json TEXT,
  CHECK ((state = 'done') = (result_json IS NOT NULL))
) WITHOUT ROWID;

CREATE INDEX token_queue_by_state ON token_queue (state, received_at, ticket);

CREATE TABLE queue_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rate_per_second INTEGER NOT NULL CHECK (rate_per_second > 0),
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  dropped INTEGER NOT NULL DEFAULT 0,
  abandoned_results INTEGER NOT NULL DEFAULT 0
)
