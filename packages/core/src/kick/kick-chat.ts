import type { ResolvedConfig } from "../config.ts"
import { errorClass } from "../lib/error-class.ts"
import type {
  ChatAudience,
  ChatListener,
  ChatSource,
  ChatSourceFactory,
} from "../platform/chat-source.ts"
import type { StreamerAccess } from "../platform/provider.ts"
import type { Clock, Instant } from "../ports.ts"
import { topicsOf, type KickChatWatches, type WatchInterest } from "./chat-watches.ts"
import { KickInvalid, KickRateLimited } from "./errors.ts"
import { kickEvents, type KickClient, type KickEvent, type KickTopic } from "./kick-client.ts"

export type KickChatConfig = Pick<
  ResolvedConfig,
  "kickSubscribeRetryDelaySeconds" | "kickSubscribeMaxAttempts"
>

export interface KickChatDeps {
  readonly giveawayId: string
  readonly client: Pick<KickClient, "subscribe" | "subscriptions" | "unsubscribe">
  readonly watches: KickChatWatches
  readonly clock: Clock
  readonly config: KickChatConfig
  readonly streamerAccess: () => Promise<StreamerAccess>
}

/** Kick's chat source: events arrive by webhook, so a room's source only keeps its watch and the channel's subscriptions. */
export function kickChat(deps: KickChatDeps): ChatSourceFactory {
  return (listener) => new KickChat(deps, listener)
}

/**
 * Keeps a room's row in the watch table and the channel's subscriptions at Kick: chat while the room
 * reads a keyword or winners, the subscription and redemption events while its topics ask for them. Every change to the table or
 * to Kick runs in order on one chain, so a close never overtakes the open before it, and a step that
 * fails is logged and does not stop the steps after it. A failed attach is retried at
 * {@link KickChat.wakeAt}; after the last attempt, or at once when Kick refuses the chat subscription for
 * good, the source gives up. A refused sub or redemption subscription only ends those topics.
 */
export class KickChat implements ChatSource {
  private running = false
  private closed = false
  private attached = false
  private attempts = 0
  private retryAt: Instant | null = null
  private audience: ChatAudience = { kind: "chatters", userIds: [] }
  // The broadcaster id of the giveaway's channel, read once from the streamer's access.
  private channel: string | null = null
  // Set once Kick refused a sub or redemption subscription: the watch reads chat only from then on.
  private channelEntryRefused = false
  // The interest last written to the watch table, as JSON; null until a write succeeded.
  private written: string | null = null
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly deps: KickChatDeps,
    private readonly listener: ChatListener,
  ) {}

  open(audience: ChatAudience): void {
    this.audience = audience
    if (!this.running) {
      this.running = true
      this.closed = false
      this.attempts = 0
      this.enqueue(() => this.attach())
      return
    }
    if (this.attached && JSON.stringify(this.interest()) !== this.written) {
      this.enqueue(() => this.refresh())
    }
  }

  /**
   * Stops reading and removes the room's watch, and each subscription of the channel no other watch
   * reads. It runs on a fresh source that never opened too, so a room that lost its source with its
   * process still removes what the old one left; a source closed since its last open is left alone.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.running = false
    this.attached = false
    this.retryAt = null
    this.written = null
    this.enqueue(() => this.detach())
  }

  wakeAt(): Instant | null {
    return this.running ? this.retryAt : null
  }

  onAlarm(): void {
    if (!this.running || this.retryAt === null || this.deps.clock.now() < this.retryAt) return
    this.retryAt = null
    this.enqueue(() => this.attach())
  }

  private enqueue(step: () => Promise<void>): void {
    this.chain = this.chain.then(step).catch((error: unknown) => {
      console.warn("kick chat step failed", {
        giveawayId: this.deps.giveawayId,
        errorClass: errorClass(error),
      })
    })
  }

  private interest(): WatchInterest {
    const topics = this.listener.topics()
    const entryOn = !this.channelEntryRefused
    return {
      chatterIds: this.audience.kind === "chatters" ? this.audience.userIds : [],
      keyword: this.audience.kind === "keyword" ? this.audience.keyword : null,
      subEntry: entryOn && topics.subscriptions,
      rewardId: entryOn ? topics.pointsRewardId : null,
    }
  }

  private async attach(): Promise<void> {
    if (!this.running) return
    try {
      const access = await this.deps.streamerAccess()
      this.channel = access.broadcasterId
      await this.sync(access.broadcasterId, true)
      this.attached = true
    } catch (error) {
      this.attachFailed(error)
    }
  }

  // A failed change of what the room reads is retried as an attach, which writes the interest of then.
  private async refresh(): Promise<void> {
    if (!this.running || this.channel === null) return
    try {
      await this.sync(this.channel, false)
    } catch (error) {
      this.attached = false
      this.attachFailed(error)
    }
  }

  // The watch is written before the subscriptions are made, so the webhook route never cancels a fresh
  // subscription as one no room watches. `verify` asks Kick which stored subscriptions still exist.
  private async sync(channel: string, verify: boolean): Promise<void> {
    const interest = await this.writeWatch(channel)
    if (interest === null) return
    const refusal = await this.ensureSubscriptions(channel, topicsOf(interest), verify)
    if (refusal !== null) {
      this.channelEntryRefused = true
      this.listener.onChannelEntryUnavailable(refusal)
      await this.writeWatch(channel)
    }
    await this.releaseUnneeded(channel)
  }

  // Null when the source closed meanwhile, and nothing was written.
  private async writeWatch(channel: string): Promise<WatchInterest | null> {
    if (!this.running) return null
    const interest = this.interest()
    await this.deps.watches.watch(this.deps.giveawayId, channel, interest, this.deps.clock.now())
    this.written = JSON.stringify(interest)
    return interest
  }

  /**
   * Makes the subscriptions the topics need and the channel lacks, in one call. A stored
   * subscription Kick no longer lists (it drops one whose webhook failed for a day) is forgotten and made
   * again. Throws when Kick refuses the chat subscription; a refused sub or redemption subscription is
   * returned instead, since chat goes on without it.
   */
  private async ensureSubscriptions(
    channel: string,
    topics: readonly KickTopic[],
    verify: boolean,
  ): Promise<KickInvalid | null> {
    const stored = new Map(
      (await this.deps.watches.subscriptionsOf(channel)).map((row) => [
        row.event,
        row.subscriptionId,
      ]),
    )
    if (verify && stored.size > 0) {
      const listed = new Set(
        (await this.deps.client.subscriptions(channel)).map((subscription) => subscription.id),
      )
      for (const [event, subscriptionId] of stored) {
        if (listed.has(subscriptionId)) continue
        await this.deps.watches.forgetSubscription(subscriptionId)
        stored.delete(event)
      }
    }
    const missing = kickEvents.filter(
      (event) => topics.includes(event.topic) && !stored.has(event.name),
    )
    if (missing.length === 0) return null
    const outcomes = await this.deps.client.subscribe(channel, missing)
    let chatRefusal: KickInvalid | null = null
    let entryRefusal: KickInvalid | null = null
    for (const event of missing) {
      const outcome = outcomes.get(event.name)
      if (outcome?.ok === true) {
        await this.store(channel, event, outcome.subscriptionId)
        continue
      }
      const refusal = new KickInvalid("subscribe", 200, {
        reason: outcome === undefined ? null : outcome.error,
      })
      if (event.topic === "chat") chatRefusal = refusal
      else entryRefusal ??= refusal
    }
    if (chatRefusal !== null) throw chatRefusal
    return entryRefusal
  }

  // A second room of the channel may subscribe at the same time: the one that stores second cancels its
  // own, unless Kick answered both with the same subscription.
  private async store(channel: string, event: KickEvent, subscriptionId: string): Promise<void> {
    let saved: boolean
    try {
      saved = await this.deps.watches.saveSubscription(
        channel,
        event,
        subscriptionId,
        this.deps.clock.now(),
      )
    } catch (error) {
      await this.cancel(subscriptionId)
      throw error
    }
    if (saved) return
    const kept = await this.deps.watches.subscriptionsOf(channel)
    if (!kept.some((row) => row.subscriptionId === subscriptionId))
      await this.cancel(subscriptionId)
  }

  // A subscription with no row that this cannot cancel is cancelled by the webhook route, which finds no watch for it.
  private async cancel(subscriptionId: string): Promise<void> {
    try {
      await this.deps.client.unsubscribe(subscriptionId)
    } catch (error) {
      console.warn("kick chat unsubscribe failed", {
        giveawayId: this.deps.giveawayId,
        errorClass: errorClass(error),
      })
    }
  }

  // A refusal Kick gives for good (4xx other than 429) ends the watch at once; a 429 waits twice as long each time.
  private attachFailed(error: unknown): void {
    if (!this.running) return
    this.attempts += 1
    const permanent = error instanceof KickInvalid
    if (!permanent && this.attempts < this.deps.config.kickSubscribeMaxAttempts) {
      const factor = error instanceof KickRateLimited ? 2 ** (this.attempts - 1) : 1
      this.retryAt =
        this.deps.clock.now() + this.deps.config.kickSubscribeRetryDelaySeconds * 1000 * factor
      this.listener.onSchedule()
      return
    }
    this.running = false
    this.closed = true
    this.retryAt = null
    this.enqueue(() => this.detach())
    this.listener.onUnavailable(error)
  }

  private async detach(): Promise<void> {
    const broadcasterId = await this.deps.watches.unwatch(this.deps.giveawayId)
    if (broadcasterId === null) return
    await this.releaseUnneeded(broadcasterId)
  }

  // A row goes only after Kick deleted its subscription, so a failed delete leaves a record the webhook
  // route can still cancel by. Each subscription is deleted on its own: one Kick refuses keeps no other.
  private async releaseUnneeded(broadcasterId: string): Promise<void> {
    for (const subscriptionId of await this.deps.watches.unneededSubscriptions(broadcasterId)) {
      try {
        await this.deps.client.unsubscribe(subscriptionId)
        await this.deps.watches.forgetSubscription(subscriptionId)
      } catch (error) {
        console.warn("kick chat unsubscribe failed", {
          giveawayId: this.deps.giveawayId,
          errorClass: errorClass(error),
        })
      }
    }
  }
}
