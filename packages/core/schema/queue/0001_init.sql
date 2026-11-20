-- The token queue of one deployment: authorization codes waiting for the token endpoint and the counters of the queue.

CREATE TABLE token_queue (
  ticket TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  giveaway_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'done')),
  -- When a pass claimed the row for the token endpoint. Set exactly while `processing`.
  claimed_at INTEGER,
  result_json TEXT,
  -- The verified platform user of a finished result. NULL while queued, and when sign-in failed before that.
  user_id TEXT,
  -- 1 once the result was handed to the browser, so a purged result still at 0 was abandoned.
  polled INTEGER NOT NULL DEFAULT 0 CHECK (polled IN (0, 1)),
  CHECK ((state = 'done') = (result_json IS NOT NULL)),
  CHECK ((state = 'processing') = (claimed_at IS NOT NULL)),
  CHECK (state = 'done' OR user_id IS NULL)
) WITHOUT ROWID;

CREATE INDEX token_queue_by_state ON token_queue (state, received_at, ticket);

CREATE TABLE queue_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rate_per_second INTEGER NOT NULL CHECK (rate_per_second > 0),
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  dropped INTEGER NOT NULL DEFAULT 0,
  abandoned_results INTEGER NOT NULL DEFAULT 0
)
