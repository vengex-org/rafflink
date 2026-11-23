-- 1 once the platform refused the sub (or points) subscriptions of a watch that also reads chat: that way of entry stops for the rest of the giveaway, chat entry, claims and the other way go on.
ALTER TABLE room_state ADD COLUMN sub_entry_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (sub_entry_unavailable IN (0, 1));

ALTER TABLE room_state ADD COLUMN points_entry_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (points_entry_unavailable IN (0, 1));

-- The one flag stood for both ways, so a room that had it keeps both off.
UPDATE room_state SET sub_entry_unavailable = channel_entry_unavailable, points_entry_unavailable = channel_entry_unavailable;

ALTER TABLE room_state DROP COLUMN channel_entry_unavailable;
