-- The streamer pressed Draw while entries were open: the alarm draws the first winner once the committed drand round is published. Cleared by the draw. Kept in the row because an idle Durable Object is evicted before the round comes.
ALTER TABLE room_state ADD COLUMN draw_requested INTEGER NOT NULL DEFAULT 0 CHECK (draw_requested IN (0, 1))
