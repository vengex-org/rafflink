-- The giveaway rooms that read a Kick channel's chat now. The webhook route forwards a chat message only to the rooms of its channel whose chatters include the sender, so most messages of a busy chat never reach a room. `chatter_ids` is a JSON array of Kick user ids, NULL while the room reads every chatter.
CREATE TABLE kick_chat_watches (
  giveaway_id TEXT PRIMARY KEY,
  broadcaster_id TEXT NOT NULL,
  chatter_ids TEXT,
  updated_at INTEGER NOT NULL
);

-- Every webhook looks its channel up.
CREATE INDEX kick_chat_watches_by_broadcaster ON kick_chat_watches (broadcaster_id);

-- The Kick chat subscription of a channel, shared by every room that watches the channel. It is deleted, here and at Kick, with the last watch.
CREATE TABLE kick_chat_subscriptions (
  broadcaster_id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Ids of the webhook messages forwarded to a room, so a replayed message reaches no room twice. A row older than the timestamp window is deleted, because a replay that old fails the timestamp check.
CREATE TABLE kick_webhook_messages (
  message_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX kick_webhook_messages_by_time ON kick_webhook_messages (received_at);
