-- The commitment of a closed room: the Merkle root over its entrants and the drand round whose randomness draws the winners.
-- Additive and nullable: a room that closed before this migration has no root, round or salt.

ALTER TABLE room_state ADD COLUMN merkle_root BLOB;

ALTER TABLE room_state ADD COLUMN drand_round INTEGER;

-- When the room committed, and the drand chain it committed to, so a verifier needs neither the config of today nor the word of the operator about the clock of the commit.
ALTER TABLE room_state ADD COLUMN committed_at INTEGER;

ALTER TABLE room_state ADD COLUMN drand_chain_hash TEXT;

ALTER TABLE room_state ADD COLUMN drand_genesis_seconds INTEGER;

ALTER TABLE room_state ADD COLUMN drand_period_seconds INTEGER;

-- How many winners the draw picks. Fixed while entries are open and frozen by the close, so it is settled before the round is known. A room that exists already gets 1.
ALTER TABLE room_state ADD COLUMN winner_count INTEGER NOT NULL DEFAULT 1 CHECK (winner_count >= 1);

-- 16 random bytes per entry, shown only to its entrant, filled at commit for an entry written before this migration.
ALTER TABLE entries ADD COLUMN salt BLOB;

-- Position of the winner in the entrants sorted by (platform, platform_user_id), which is the order of the leaves.
ALTER TABLE draws ADD COLUMN leaf_index INTEGER;

-- The published leaf list in chunks, so a giveaway costs a dozen row writes and not one per entrant. It outlives the entries.
CREATE TABLE leaves (
  chunk INTEGER PRIMARY KEY,
  data BLOB NOT NULL
)
