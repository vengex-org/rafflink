import type { ResolvedConfig } from "../config.ts"
import { isEntryMessage } from "../domain/rules.ts"
import { errorClass } from "../lib/error-class.ts"
import type {
  ChatAudience,
  ChatListener,
  ChatMessage,
  ChatSource,
  ChatSourceFactory,
} from "../platform/chat-source.ts"
import type { StreamerAccess } from "../platform/provider.ts"
import type { Clock, Instant } from "../ports.ts"
import { YouTubeInvalid, YouTubeQuotaExhausted } from "./errors.ts"
import type { YouTubeChatItem } from "./lib/parse-response.ts"
import { youtubeLogin } from "./lib/login.ts"
import type { YouTubeClient } from "./youtube-client.ts"

export type YouTubeChatConfig = Pick<
  ResolvedConfig,
  | "youtubeChatPollMinMs"
  | "youtubeChatRetryDelaySeconds"
  | "youtubeChatMaxAttempts"
  | "youtubeBroadcastRetrySeconds"
>

export interface YouTubeChatDeps {
  readonly giveawayId: string
  readonly client: Pick<YouTubeClient, "activeLiveChatId" | "chatPage">
  readonly clock: Clock
  readonly config: YouTubeChatConfig
  readonly streamerAccess: () => Promise<StreamerAccess>
}

/** YouTube's chat source: the room's alarm reads the live chat page by page, as often as YouTube asks and no more. */
export function youtubeChat(deps: YouTubeChatDeps): ChatSourceFactory {
  return (listener) => new YouTubeChat(deps, listener)
}

// YouTube refuses a page of a chat that is over or gone; the streamer's next broadcast has a new chat.
const chatGoneReasons = ["liveChatEnded", "liveChatNotFound", "liveChatDisabled"]

/**
 * Reads the live chat of the streamer's active broadcast while open: one read at a time, the next one at
 * {@link YouTubeChat.wakeAt}, no sooner than YOUTUBE_CHAT_POLL_MIN_MS. Nothing is held at YouTube, so a
 * close only stops reading. Without an active broadcast, or after its chat ended, it looks for one every
 * YOUTUBE_BROADCAST_RETRY_SECONDS. It gives up after YOUTUBE_CHAT_MAX_ATTEMPTS failed reads in a row, and
 * at once when YouTube refuses the token or the install's daily quota is spent.
 */
export class YouTubeChat implements ChatSource {
  private running = false
  private reading = false
  // Counts opens, so a read that started before a close and a reopen delivers nothing.
  private generation = 0
  private failures = 0
  private nextReadAt: Instant | null = null
  private audience: ChatAudience = { kind: "chatters", userIds: [] }
  private liveChatId: string | null = null
  private pageToken: string | null = null
  // The first page of a chat holds what was written before the watch opened; that is not read.
  private openedAt: Instant = 0

  constructor(
    private readonly deps: YouTubeChatDeps,
    private readonly listener: ChatListener,
  ) {}

  open(audience: ChatAudience): void {
    this.audience = audience
    if (this.running) return
    this.running = true
    this.generation += 1
    this.failures = 0
    this.openedAt = this.deps.clock.now()
    void this.read()
  }

  close(): void {
    this.running = false
    this.nextReadAt = null
    this.liveChatId = null
    this.pageToken = null
  }

  wakeAt(): Instant | null {
    return this.running && !this.reading ? this.nextReadAt : null
  }

  onAlarm(): void {
    const due = this.nextReadAt
    if (!this.running || this.reading || due === null || this.deps.clock.now() < due) return
    void this.read()
  }

  private async read(): Promise<void> {
    const generation = this.generation
    this.reading = true
    this.nextReadAt = null
    try {
      const next = await this.readOnce(generation)
      if (generation !== this.generation) return
      this.nextReadAt = next
      this.failures = 0
    } catch (error) {
      if (generation === this.generation) this.failed(error)
    } finally {
      if (generation === this.generation) {
        this.reading = false
        if (this.running) this.listener.onSchedule()
      }
    }
  }

  // The instant of the next read.
  private async readOnce(generation: number): Promise<Instant> {
    const { accessToken } = await this.deps.streamerAccess()
    const liveChatId = this.liveChatId ?? (await this.deps.client.activeLiveChatId(accessToken))
    const now = () => this.deps.clock.now()
    if (liveChatId === null) return now() + this.deps.config.youtubeBroadcastRetrySeconds * 1000
    this.liveChatId = liveChatId
    let page
    try {
      page = await this.deps.client.chatPage(accessToken, liveChatId, this.pageToken)
    } catch (error) {
      if (!(error instanceof YouTubeInvalid && chatGoneReasons.includes(error.reason ?? ""))) {
        throw error
      }
      this.forgetChat()
      return now() + this.deps.config.youtubeBroadcastRetrySeconds * 1000
    }
    if (generation !== this.generation || !this.running) return now()
    this.pageToken = page.nextPageToken
    for (const item of page.items) {
      if (item.publishedAt < this.openedAt) continue
      const message = chatMessageOf(item)
      if (this.reads(message)) this.listener.onMessage(message)
    }
    if (page.offline) {
      this.forgetChat()
      return now() + this.deps.config.youtubeBroadcastRetrySeconds * 1000
    }
    return now() + Math.max(page.pollingIntervalMillis, this.deps.config.youtubeChatPollMinMs)
  }

  private forgetChat(): void {
    this.liveChatId = null
    this.pageToken = null
  }

  // Only the messages the room reads reach it: the entry keyword while it is open, otherwise the winners'.
  private reads(message: ChatMessage): boolean {
    const audience = this.audience
    return audience.kind === "keyword"
      ? isEntryMessage(message.text, audience.keyword)
      : audience.userIds.includes(message.platformUserId)
  }

  private failed(error: unknown): void {
    if (!this.running) return
    this.failures += 1
    console.warn("youtube chat read failed", {
      giveawayId: this.deps.giveawayId,
      errorClass: errorClass(error),
      attempt: this.failures,
    })
    const permanent =
      error instanceof YouTubeQuotaExhausted
      || (error instanceof YouTubeInvalid && error.reason !== "rateLimitExceeded")
    if (!permanent && this.failures < this.deps.config.youtubeChatMaxAttempts) {
      this.nextReadAt = this.deps.clock.now() + this.deps.config.youtubeChatRetryDelaySeconds * 1000
      return
    }
    this.close()
    this.listener.onUnavailable(error)
  }
}

// A member reads as tier 1 (YouTube has one level here); the channel's owner counts as its moderator.
function chatMessageOf(item: YouTubeChatItem): ChatMessage {
  return {
    platformUserId: item.authorChannelId,
    login: youtubeLogin(item.displayName) ?? item.authorChannelId.toLowerCase(),
    displayName: item.displayName,
    text: item.text,
    roles: {
      subTier: item.isChatSponsor ? 1 : null,
      isVip: false,
      isModerator: item.isChatModerator || item.isChatOwner,
    },
  }
}
