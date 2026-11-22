import type { Instant } from "../ports.ts"

/** A chat badge as the platform names it: its set (`subscriber`, `vip`) and the version within the set. */
export interface ChatBadge {
  readonly setId: string
  readonly id: string
}

/** A chat message as the room reads it, whatever the platform's transport. */
export interface ChatMessage {
  readonly platformUserId: string
  readonly login: string
  readonly displayName: string
  readonly text: string
  readonly badges: readonly ChatBadge[]
}

/** What a chat source tells the room that owns it. */
export interface ChatListener {
  readonly onMessage: (message: ChatMessage) => void
  /** Called once when the source gives up; the source is closed by then. */
  readonly onUnavailable: (cause: unknown) => void
  /** Called when a connection event moved {@link ChatSource.wakeAt}, so the owner can re-arm its alarm. */
  readonly onSchedule: () => void
}

/**
 * The chat of the room's channel. It has no timers: the owner calls {@link ChatSource.onAlarm} at
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
