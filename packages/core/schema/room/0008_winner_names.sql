-- The winner's login and display name, copied from the entry at pick time, so the winner list keeps its names after the retention alarm deleted the entries. NULL for a pick whose entry was deleted before this migration.
ALTER TABLE draws ADD COLUMN login TEXT;

ALTER TABLE draws ADD COLUMN display_name TEXT;

UPDATE draws SET
  login = (SELECT e.login FROM entries e WHERE e.platform = draws.platform AND e.platform_user_id = draws.platform_user_id),
  display_name = (SELECT e.display_name FROM entries e WHERE e.platform = draws.platform AND e.platform_user_id = draws.platform_user_id);
