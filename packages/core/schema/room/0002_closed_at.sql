-- When the room stopped taking entries, which is where the retention deadline starts.
ALTER TABLE room_state ADD COLUMN closed_at INTEGER;

-- Rooms closed before this column existed get the latest moment they are known to have been closed or drawn.
UPDATE room_state SET closed_at = COALESCE((SELECT MAX(drawn_at) FROM draws), closes_at, (SELECT MAX(entered_at) FROM entries), 0) WHERE status != 'open';
