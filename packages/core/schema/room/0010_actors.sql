-- Who pressed each action: 'streamer' or 'mod:<moderator link id>'. NULL for what the room did by itself (the end time closed entries) and for rows written before these columns.
ALTER TABLE room_state ADD COLUMN closed_by TEXT;

-- Who pressed Draw while entries were open. The first winner the alarm then draws is theirs.
ALTER TABLE room_state ADD COLUMN draw_requested_by TEXT;

ALTER TABLE draws ADD COLUMN drawn_by TEXT;

ALTER TABLE draws ADD COLUMN rerolled_by TEXT;

-- Set only for a claim marked by hand (claimed_via = 'manual').
ALTER TABLE draws ADD COLUMN claim_marked_by TEXT;
