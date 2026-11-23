import { isEntryMessage } from "../domain/rules.ts"
import type { ChannelEntryEvent } from "../platform/chat-source.ts"
import type { AsyncSql, Instant, SqlRow } from "../ports.ts"
import type { KickEvent, KickTopic } from "./kick-client.ts"

/** A stored row that does not have the shape the Kick chat tables give it. */
export class KickChatRowError extends Error {
  constructor(readonly column: string) {
    super("kick chat row has an unexpected shape")
  }
}

/** The rooms that read one event of a channel, and whether any room of the channel reads the event's topic at all. */
export interface ChannelReaders {
  /** False when no watch of the channel reads the topic, so the subscription the event came by is left over. */
  readonly watched: boolean
  readonly readers: readonly string[]
}

/** What one room reads of its channel. */
export interface WatchInterest {
  /** The winners whose every message the room reads. */
  readonly chatterIds: readonly string[]
  /** Messages starting with it ask to enter; null while chat entries are not open. */
  readonly keyword: string | null
  readonly subEntry: boolean
  readonly rewardId: string | null
}

/** A subscription of a channel as the table keeps it. */
export interface StoredSubscription {
  readonly event: string
  readonly subscriptionId: string
}

/**
 * The Kick chat tables of the account store: which rooms watch which channel and what each reads, the
 * subscriptions of each channel, and the ids of forwarded webhook messages.
 */
export class KickChatWatches {
  constructor(private readonly sql: AsyncSql) {}

  /** Records what the room reads of the channel. */
  async watch(
    giveawayId: string,
    broadcasterId: string,
    interest: WatchInterest,
    now: Instant,
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO kick_chat_watches (giveaway_id, broadcaster_id, chatter_ids, keyword, sub_entry, reward_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (giveaway_id) DO UPDATE SET broadcaster_id = excluded.broadcaster_id,
          chatter_ids = excluded.chatter_ids, keyword = excluded.keyword, sub_entry = excluded.sub_entry,
          reward_id = excluded.reward_id, updated_at = excluded.updated_at`,
      [
        giveawayId,
        broadcasterId,
        JSON.stringify(interest.chatterIds),
        interest.keyword,
        interest.subEntry ? 1 : 0,
        interest.rewardId,
        now,
      ],
    )
  }

  /** Removes the room's watch and returns the channel it watched; `null` when the room watched nothing. */
  async unwatch(giveawayId: string): Promise<string | null> {
    const [row] = await this.sql.all(
      "DELETE FROM kick_chat_watches WHERE giveaway_id = ? RETURNING broadcaster_id",
      [giveawayId],
    )
    return row === undefined ? null : textOf(row, "broadcaster_id")
  }

  /**
   * The giveaways watching the channel that read this chat message: from a chatter they read, or one that
   * asks to enter with their keyword. One read per message, matched here, so only the messages a room
   * reads cost a room call.
   */
  async chatReaders(
    broadcasterId: string,
    senderId: string,
    text: string,
  ): Promise<ChannelReaders> {
    const rows = await this.sql.all(
      `SELECT giveaway_id, keyword,
          EXISTS (SELECT 1 FROM json_each(chatter_ids) WHERE value = ?) AS reads,
          ${readsChatSql} AS reads_chat
        FROM kick_chat_watches w WHERE broadcaster_id = ?`,
      [senderId, broadcasterId],
    )
    return {
      watched: rows.some((row) => row.reads_chat === 1),
      readers: rows
        .filter((row) => {
          const keyword = nullableText(row, "keyword")
          return row.reads === 1 || (keyword !== null && isEntryMessage(text, keyword))
        })
        .map((row) => textOf(row, "giveaway_id")),
    }
  }

  /** The giveaways watching the channel that take this sub or redemption. */
  async channelEntryReaders(
    broadcasterId: string,
    event: ChannelEntryEvent,
  ): Promise<ChannelReaders> {
    const rows = await this.sql.all(
      "SELECT giveaway_id, sub_entry, reward_id FROM kick_chat_watches WHERE broadcaster_id = ?",
      [broadcasterId],
    )
    return {
      watched: rows.some((row) =>
        event.via === "sub" ? row.sub_entry === 1 : nullableText(row, "reward_id") !== null,
      ),
      readers: rows
        .filter((row) =>
          event.via === "sub"
            ? row.sub_entry === 1
            : nullableText(row, "reward_id") === event.rewardId,
        )
        .map((row) => textOf(row, "giveaway_id")),
    }
  }

  /** The channel's subscriptions. */
  async subscriptionsOf(broadcasterId: string): Promise<readonly StoredSubscription[]> {
    const rows = await this.sql.all(
      "SELECT event, subscription_id FROM kick_event_subscriptions WHERE broadcaster_id = ?",
      [broadcasterId],
    )
    return rows.map((row) => ({
      event: textOf(row, "event"),
      subscriptionId: textOf(row, "subscription_id"),
    }))
  }

  /** Stores the channel's subscription of an event; false when another room stored one first, which is kept. */
  async saveSubscription(
    broadcasterId: string,
    event: KickEvent,
    subscriptionId: string,
    now: Instant,
  ): Promise<boolean> {
    const rows = await this.sql.all(
      `INSERT INTO kick_event_subscriptions (broadcaster_id, event, topic, subscription_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (broadcaster_id, event) DO NOTHING RETURNING broadcaster_id`,
      [broadcasterId, event.name, event.topic, subscriptionId, now],
    )
    return rows.length > 0
  }

  /** The ids of the channel's subscriptions that no watch of the channel reads any more. */
  async unneededSubscriptions(broadcasterId: string): Promise<readonly string[]> {
    const rows = await this.sql.all(
      `SELECT subscription_id FROM kick_event_subscriptions s WHERE broadcaster_id = ?
        AND NOT EXISTS (SELECT 1 FROM kick_chat_watches w WHERE w.broadcaster_id = s.broadcaster_id
          AND ((s.topic = 'chat' AND ${readsChatSql}) OR (s.topic = 'sub' AND w.sub_entry = 1)
            OR (s.topic = 'points' AND w.reward_id IS NOT NULL)))`,
      [broadcasterId],
    )
    return rows.map((row) => textOf(row, "subscription_id"))
  }

  /** Deletes the row of a subscription that is gone at Kick; a row with another id is kept. */
  async forgetSubscription(subscriptionId: string): Promise<void> {
    await this.sql.run("DELETE FROM kick_event_subscriptions WHERE subscription_id = ?", [
      subscriptionId,
    ])
  }

  /**
   * Records a webhook message as forwarded; false when it was already, which makes it a replay. Rows
   * received before `forgetBefore` are deleted first.
   */
  async firstDelivery(messageId: string, now: Instant, forgetBefore: Instant): Promise<boolean> {
    await this.sql.run("DELETE FROM kick_webhook_messages WHERE received_at < ?", [forgetBefore])
    const rows = await this.sql.all(
      `INSERT INTO kick_webhook_messages (message_id, received_at) VALUES (?, ?)
        ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
      [messageId, now],
    )
    return rows.length > 0
  }
}

/** The topics a watch with this interest reads; chat only for its winners or its keyword. */
export function topicsOf(interest: WatchInterest): readonly KickTopic[] {
  const topics: KickTopic[] = []
  if (interest.keyword !== null || interest.chatterIds.length > 0) topics.push("chat")
  if (interest.subEntry) topics.push("sub")
  if (interest.rewardId !== null) topics.push("points")
  return topics
}

// A watch reads chat for its keyword or its winners; a sub or points only watch does not, so a chat message
// of its channel would cost a Worker request and a D1 read for nothing. The {@link topicsOf} rule in SQL, on alias `w`.
const readsChatSql = "(w.keyword IS NOT NULL OR json_array_length(w.chatter_ids) > 0)"

function textOf(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== "string") throw new KickChatRowError(column)
  return value
}

function nullableText(row: SqlRow, column: string): string | null {
  const value = row[column]
  if (value === null) return null
  if (typeof value !== "string") throw new KickChatRowError(column)
  return value
}
