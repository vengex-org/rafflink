-- How many winners the draw picks, chosen at creation and passed to the room, which owns it from then on. A giveaway that exists already gets 1.
ALTER TABLE giveaways ADD COLUMN winner_count INTEGER NOT NULL DEFAULT 1 CHECK (winner_count >= 1);
