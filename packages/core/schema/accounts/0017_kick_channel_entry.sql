-- What else a room reads of its Kick channel besides its chatters' messages, so the webhook route forwards only that: chat messages that start with `keyword` while chat entries are open, subscriptions while `sub_entry` is 1, and redemptions of the reward `reward_id`. The route matches the keyword itself, so a chat message that asks for nothing never reaches a room.
ALTER TABLE kick_chat_watches ADD COLUMN keyword TEXT;

ALTER TABLE kick_chat_watches ADD COLUMN sub_entry INTEGER NOT NULL DEFAULT 0 CHECK (sub_entry IN (0, 1));

ALTER TABLE kick_chat_watches ADD COLUMN reward_id TEXT;

-- Kick subscribes each event on its own, so a channel holds one subscription per event: chat messages while a watch reads a keyword or winners, the three subscription events and the redemption event while a watch reads them. `topic` names what a watch must read for the subscription to stay. It is deleted, here and at Kick, once no watch of the channel does.
CREATE TABLE kick_event_subscriptions (
  broadcaster_id TEXT NOT NULL,
  event TEXT NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('chat', 'sub', 'points')),
  subscription_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (broadcaster_id, event)
);

-- A subscription that is gone at Kick is forgotten by its id.
CREATE UNIQUE INDEX kick_event_subscriptions_by_id ON kick_event_subscriptions (subscription_id);

INSERT INTO kick_event_subscriptions (broadcaster_id, event, topic, subscription_id, created_at)
  SELECT broadcaster_id, 'chat.message.sent', 'chat', subscription_id, created_at FROM kick_chat_subscriptions;

DROP TABLE kick_chat_subscriptions;
