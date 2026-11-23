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
import type { KickChatWatches } from "./chat-watches.ts"
import { KickInvalid, KickRateLimited } from "./errors.ts"
import type { KickClient } from "./kick-client.ts"

export type KickChatConfig = Pick<
  ResolvedConfig,
  "kickSubscribeRetryDelaySeconds" | "kickSubscribeMaxAttempts"
>

export interface KickChatDeps {
  readonly giveawayId: string
  readonly client: Pick<KickClient, "subscribeChat" | "chatSubscriptionIds" | "unsubscribe">
  readonly watches: KickChatWatches
  readonly clock: Clock
  readonly config: KickChatConfig
  readonly streamerAccess: () => Promise<StreamerAccess>
}

/** Kick's chat source: messages arrive by webhook, so a room's source only keeps its watch and the channel's subscription. */
export function kickChat(deps: KickChatDeps): ChatSourceFactory {
  return (listener) => new KickChat(deps, listener)
}

/**
 * Keeps a room's row in the watch table and the channel's chat subscription at Kick. Every change to
 * the table or to Kick runs in order on one chain, so a close never overtakes the open before it, and a
 * step that fails is logged and does not stop the steps after it. A failed attach is retried at
 * {@link KickChat.wakeAt}; after the last attempt, or at once when Kick refuses for good, the source gives up.
 */
export class KickChat implements ChatSource {
  private running = false
  private closed = false
  private attached = false
  private attempts = 0
  private retryAt: Instant | null = null
  private audience: ChatAudience = { kind: "everyone" }
  // The broadcaster id of the giveaway's channel, read once from the streamer's access.
  private channel: string | null = null
  // The audience last written to the watch table, as JSON; null until a write succeeded.
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
    if (this.attached && audienceKey(audience) !== this.written) {
      this.enqueue(() => this.writeWatch())
    }
  }

  /**
   * Stops reading and removes the room's watch, and the channel's subscription when no other room
   * watches it. It runs on a fresh source that never opened too, so a room that lost its source with its
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

  private async attach(): Promise<void> {
    if (!this.running) return
    try {
      const access = await this.deps.streamerAccess()
      this.channel = access.broadcasterId
      await this.writeWatch()
      await this.ensureSubscription(access.broadcasterId)
      this.attached = true
    } catch (error) {
      this.attachFailed(error)
    }
  }

  private async writeWatch(): Promise<void> {
    if (!this.running || this.channel === null) return
    const key = audienceKey(this.audience)
    await this.deps.watches.watch(
      this.deps.giveawayId,
      this.channel,
      this.audience.kind === "everyone" ? null : this.audience.userIds,
      this.deps.clock.now(),
    )
    this.written = key
  }

  // A stored subscription Kick no longer lists (it drops one whose webhook failed for a day) is forgotten
  // and made again. A second room of the channel may subscribe at the same time: the one that stores
  // second cancels its own, unless Kick answered both with the same subscription.
  private async ensureSubscription(broadcasterId: string): Promise<void> {
    const stored = await this.deps.watches.subscriptionOf(broadcasterId)
    if (stored !== null) {
      if ((await this.deps.client.chatSubscriptionIds(broadcasterId)).includes(stored)) return
      await this.deps.watches.forgetSubscription(stored)
    }
    const subscriptionId = await this.deps.client.subscribeChat(broadcasterId)
    let saved: boolean
    try {
      saved = await this.deps.watches.saveSubscription(
        broadcasterId,
        subscriptionId,
        this.deps.clock.now(),
      )
    } catch (error) {
      await this.cancel(subscriptionId)
      throw error
    }
    if (!saved && (await this.deps.watches.subscriptionOf(broadcasterId)) !== subscriptionId) {
      await this.cancel(subscriptionId)
    }
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

  // The row goes only after Kick deleted the subscription, so a failed delete leaves a record the webhook
  // route can still cancel by.
  private async detach(): Promise<void> {
    const broadcasterId = await this.deps.watches.unwatch(this.deps.giveawayId)
    if (broadcasterId === null) return
    const subscriptionId = await this.deps.watches.unwatchedSubscription(broadcasterId)
    if (subscriptionId === null) return
    await this.deps.client.unsubscribe(subscriptionId)
    await this.deps.watches.forgetSubscription(subscriptionId)
  }
}

function audienceKey(audience: ChatAudience): string {
  return audience.kind === "everyone" ? "*" : JSON.stringify(audience.userIds)
}
