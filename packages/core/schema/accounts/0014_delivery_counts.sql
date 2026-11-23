-- The room's claimed picks and delivered prizes, copied with the status by the mirror, so the dashboard history reads no room. NULL until the room mirrors them, and the mirror writes both at once.
ALTER TABLE giveaways ADD COLUMN claimed INTEGER CHECK (claimed >= 0);
ALTER TABLE giveaways ADD COLUMN delivered INTEGER CHECK ((delivered IS NULL) = (claimed IS NULL) AND delivered <= claimed);
