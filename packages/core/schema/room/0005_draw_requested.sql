-- The streamer pressed Draw while entries were open: the alarm draws the first winner once the committed drand round is published. Cleared by the draw. Kept in the row because an idle Durable Object is evicted before the round comes.
ALTER TABLE room_state ADD COLUMN draw_requested INTEGER NOT NULL DEFAULT 0 CHECK (draw_requested IN (0, 1));

-- When the alarm tries the requested draw next, after a try that did not draw. Kept in the row so a rewrite of the alarm by other writes cannot push the try back.
ALTER TABLE room_state ADD COLUMN draw_retry_at INTEGER
