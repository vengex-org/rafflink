-- When the winner sent the winner form, and when the streamer marked the prize delivered. Both stay after the answers are deleted: the form is sent once, and the history and the CSV show the delivery.
ALTER TABLE draws ADD COLUMN answered_at INTEGER;
ALTER TABLE draws ADD COLUMN delivered_at INTEGER;

-- A winner's form answers, personal data such as a shipping address. The HTTP layer seals them with TOKEN_SEAL_KEYS before they reach the room, so the room holds ciphertext only. The room alarm deletes a row WINNER_FORM_RETENTION_SECONDS after the claim, and marking the prize delivered deletes it at once. At most one row per pick, and picks are capped by DRAW_MAX_WINNERS, so the deadline query reads them all.
CREATE TABLE winner_answers (
  n INTEGER NOT NULL PRIMARY KEY REFERENCES draws (n),
  sealed TEXT NOT NULL
);
