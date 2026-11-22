import type { Instant } from "../ports.ts"

/** A chat message as the room reads it: who wrote it and what, whatever the platform's transport. */
export interface ChatMessage {
  readonly platformUserId: string
  readonly text: string
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

/** How a target opens the chat of a room's channel for the room's listener. */
export type ChatSourceFactory = (listener: ChatListener) => ChatSource
