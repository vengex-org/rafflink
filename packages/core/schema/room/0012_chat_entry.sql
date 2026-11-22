-- Chatters who typed the entry keyword while entries were open, held until their profile and follow checks ran. They enter or are refused when the check comes back. After the close one more profile read runs for whoever is left, and the commit enters the rest. `sub_tier`, `vip` and `moderator` come from their chat badges.
CREATE TABLE chat_entry_requests (
  platform_user_id TEXT NOT NULL PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  sub_tier INTEGER CHECK (sub_tier IN (1, 2, 3)),
  vip INTEGER NOT NULL CHECK (vip IN (0, 1)),
  moderator INTEGER NOT NULL CHECK (moderator IN (0, 1)),
  requested_at INTEGER NOT NULL
) WITHOUT ROWID;

-- The checks take the oldest requests first.
CREATE INDEX chat_entry_requests_by_time ON chat_entry_requests (requested_at, platform_user_id);

-- How the entrant entered: on the giveaway page or with the chat keyword. An entry written before this migration came from the page.
ALTER TABLE entries ADD COLUMN via TEXT NOT NULL DEFAULT 'page' CHECK (via IN ('page', 'chat'));

-- The "Am I in?" lookup of the giveaway page finds a chat entrant by login. Page entrants are never looked up.
CREATE INDEX chat_entries_by_login ON entries (platform, login) WHERE via = 'chat';
