-- When the room stopped taking entries, which is where the retention deadline starts.
ALTER TABLE room_state ADD COLUMN closed_at INTEGER;

-- Set once the retention alarm deleted the entrants' data, so a draw or reroll cannot run on the empty list.
ALTER TABLE room_state ADD COLUMN entries_deleted INTEGER NOT NULL DEFAULT 0 CHECK (entries_deleted IN (0, 1));

-- Rooms closed before this column existed get the latest moment they are known to have been closed or drawn. A planned end time in the future is capped at now, because the streamer may have closed the room earlier by hand.
UPDATE room_state SET closed_at = COALESCE(
  (SELECT MAX(drawn_at) FROM draws),
  MIN(closes_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  (SELECT MAX(entered_at) FROM entries),
  0
) WHERE status != 'open';
