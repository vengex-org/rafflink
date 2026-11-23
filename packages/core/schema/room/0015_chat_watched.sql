-- Set while the room's chat source may hold a watch at the platform. A Kick chat watch is a row and a subscription that outlive the process that opened them, so a room that lost its chat source with the process still has to close the watch when it ends.
ALTER TABLE room_state ADD COLUMN chat_watched INTEGER NOT NULL DEFAULT 0 CHECK (chat_watched IN (0, 1));
