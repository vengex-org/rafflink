-- 1 while the streamer's token lacks the VIP and moderator scopes, so VIPs and moderators enter with viewer tickets. A role refresh that succeeds clears it.
ALTER TABLE room_state ADD COLUMN roles_paused INTEGER NOT NULL DEFAULT 0 CHECK (roles_paused IN (0, 1));
