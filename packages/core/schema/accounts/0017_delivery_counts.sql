-- The room's claimed picks and delivered prizes, copied with the status by the mirror, so the dashboard history reads no room. NULL until the room mirrors them.
ALTER TABLE giveaways ADD COLUMN claimed INTEGER CHECK (claimed >= 0);
ALTER TABLE giveaways ADD COLUMN delivered INTEGER CHECK (delivered >= 0 AND delivered <= claimed);
