import type { ViewerFacts } from "../domain/rules.ts"
import type { Instant } from "../ports.ts"

/** What the chatter's badges on this message say about them in the channel, as the platform reads its own badges. */
export interface ChatterRoles {
  readonly subTier: ViewerFacts["subTier"]
  readonly isVip: boolean
  readonly isModerator: boolean
}

/** A chat message as the room reads it, whatever the platform's transport. */
export interface ChatMessage {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  readonly text: string
  readonly roles: ChatterRoles
}

/** Who subscribed or redeemed, as the platform names them. */
export interface ChannelViewer {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
}

/** A subscription (new, renewed or received as a gift) or a channel point redemption in the room's channel. */
export type ChannelEntryEvent =
  | { readonly via: "sub"; readonly viewer: ChannelViewer; readonly subTier: 1 | 2 | 3 }
  | { readonly via: "points"; readonly viewer: ChannelViewer; readonly rewardId: string }

/** What the room's channel watch listens to; read for each new connection, so a status change reaches the next one. */
export interface WatchTopics {
  /** Chat messages: the entry keyword while entries are open, winners' claims after the draw. */
  readonly chat: boolean
  /** New subscriptions, resubscriptions and gift subs received. */
  readonly subscriptions: boolean
  /** Redemptions of this channel point reward; null for none. */
  readonly pointsRewardId: string | null
}

/** What a chat source tells the room that owns it, and asks it. */
export interface ChatListener {
  readonly onMessage: (message: ChatMessage) => void
  readonly onChannelEntry: (event: ChannelEntryEvent) => void
  readonly topics: () => WatchTopics
  /** Called once when the source gives up; the source is closed by then. */
  readonly onUnavailable: (cause: unknown) => void
  /** Called when a connection event moved {@link ChatSource.wakeAt}, so the owner can re-arm its alarm. */
  readonly onSchedule: () => void
}

/**
 * The chat and the other events of the room's channel. It has no timers: the owner calls {@link ChatSource.onAlarm} at
 * {@link ChatSource.wakeAt}.
 */
export interface ChatSource {
  /** Starts listening; a source that already listens is left alone. */
  open(): void
  /** Stops listening; a closed source is left alone. */
  close(): void
  /** The next instant {@link ChatSource.onAlarm} has work, `null` while closed. */
  wakeAt(): Instant | null
  onAlarm(): void
}

/** How a provider opens the chat of one channel for a listener. */
export type ChatSourceFactory = (listener: ChatListener) => ChatSource

/** How a target opens a room's chat: the room names its platform when it first watches. */
export type ChatOpener = (platform: string, listener: ChatListener) => ChatSource
