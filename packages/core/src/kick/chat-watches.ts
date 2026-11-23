import type { AsyncSql, Instant, SqlRow } from "../ports.ts"

/** A stored row that does not have the shape the Kick chat tables give it. */
export class KickChatRowError extends Error {
  constructor(readonly column: string) {
    super("kick chat row has an unexpected shape")
  }
}

/**
 * The Kick chat tables of the account store: which rooms watch which channel and whose messages each
 * reads, the one subscription per channel, and the ids of forwarded webhook messages.
 */
export class KickChatWatches {
  constructor(private readonly sql: AsyncSql) {}

  /** Records that the room reads the channel's chat, from `chatterIds` only, or from everyone when `null`. */
  async watch(
    giveawayId: string,
    broadcasterId: string,
    chatterIds: readonly string[] | null,
    now: Instant,
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO kick_chat_watches (giveaway_id, broadcaster_id, chatter_ids, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (giveaway_id) DO UPDATE SET broadcaster_id = excluded.broadcaster_id,
          chatter_ids = excluded.chatter_ids, updated_at = excluded.updated_at`,
      [giveawayId, broadcasterId, chatterIds === null ? null : JSON.stringify(chatterIds), now],
    )
  }

  /** Removes the room's watch and returns the channel it watched; `null` when the room watched nothing. */
  async unwatch(giveawayId: string): Promise<string | null> {
    const [row] = await this.sql.all(
      "DELETE FROM kick_chat_watches WHERE giveaway_id = ? RETURNING broadcaster_id",
      [giveawayId],
    )
    return row === undefined ? null : text(row, "broadcaster_id")
  }

  /** The giveaways watching the channel that read the sender's messages. */
  async readersOf(broadcasterId: string, senderId: string): Promise<readonly string[]> {
    const rows = await this.sql.all(
      `SELECT giveaway_id FROM kick_chat_watches WHERE broadcaster_id = ?
        AND (chatter_ids IS NULL OR EXISTS (SELECT 1 FROM json_each(chatter_ids) WHERE value = ?))`,
      [broadcasterId, senderId],
    )
    return rows.map((row) => text(row, "giveaway_id"))
  }

  /** The channel's subscription id, `null` when it has none. */
  async subscriptionOf(broadcasterId: string): Promise<string | null> {
    const [row] = await this.sql.all(
      "SELECT subscription_id FROM kick_chat_subscriptions WHERE broadcaster_id = ?",
      [broadcasterId],
    )
    return row === undefined ? null : text(row, "subscription_id")
  }

  /** Stores the channel's subscription; false when another room stored one first, which is kept. */
  async saveSubscription(
    broadcasterId: string,
    subscriptionId: string,
    now: Instant,
  ): Promise<boolean> {
    const rows = await this.sql.all(
      `INSERT INTO kick_chat_subscriptions (broadcaster_id, subscription_id, created_at) VALUES (?, ?, ?)
        ON CONFLICT (broadcaster_id) DO NOTHING RETURNING broadcaster_id`,
      [broadcasterId, subscriptionId, now],
    )
    return rows.length > 0
  }

  /**
   * Deletes the channel's subscription row when no room watches the channel any more, in one statement so a
   * room that starts watching meanwhile keeps it. Returns the deleted subscription id, `null` when kept or absent.
   */
  async releaseSubscription(broadcasterId: string): Promise<string | null> {
    const [row] = await this.sql.all(
      `DELETE FROM kick_chat_subscriptions WHERE broadcaster_id = ?
        AND NOT EXISTS (SELECT 1 FROM kick_chat_watches WHERE broadcaster_id = ?)
        RETURNING subscription_id`,
      [broadcasterId, broadcasterId],
    )
    return row === undefined ? null : text(row, "subscription_id")
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

function text(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== "string") throw new KickChatRowError(column)
  return value
}
