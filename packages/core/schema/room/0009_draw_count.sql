-- How many picks the requested draw adds at once: the alarm draws that many when the committed drand round is published. Read only while draw_requested is 1.
ALTER TABLE room_state ADD COLUMN draw_count INTEGER NOT NULL DEFAULT 1 CHECK (draw_count >= 1);
