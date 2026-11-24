import type { ResolvedConfig } from "../config.ts"
import type {
  ChannelEntryRefusal,
  ChatListener,
  ChatSource,
  ChatSourceFactory,
  WatchTopics,
} from "../platform/chat-source.ts"
import type { Clock, Instant, SocketConnector, TextSocket } from "../ports.ts"
import { parseEventSubMessage } from "./lib/parse-eventsub.ts"

export type ChatWatcherConfig = Pick<
  ResolvedConfig,
  | "eventSubUrl"
  | "eventSubKeepaliveSeconds"
  | "eventSubSubscribeSeconds"
  | "eventSubConnectionMaxSeconds"
  | "eventSubReconnectMarginSeconds"
  | "eventSubKeepaliveGraceSeconds"
  | "eventSubReconnectDelaySeconds"
  | "eventSubReconnectMaxAttempts"
>

/** What a target supplies to watch chat: its sockets, and the call that subscribes a session to the channel. */
export interface ChatLink {
  readonly connector: SocketConnector
  /**
   * Creates the subscriptions of the topics for an EventSub session. A rejection ends the watch as unavailable;
   * a refused sub or points subscription next to a held chat one is answered instead, once per entry way.
   */
  readonly subscribe: (
    sessionId: string,
    topics: WatchTopics,
  ) => Promise<readonly ChannelEntryRefusal[]>
}

/** What the Twitch chat source is built from: the target's link, with the room's clock and config. */
export interface EventSubChatDeps extends ChatLink {
  readonly clock: Clock
  readonly config: ChatWatcherConfig
}

export interface ChatWatcherDeps extends EventSubChatDeps, ChatListener {}

/** Twitch's chat source: an EventSub watcher for each room that opens one. */
export function eventSubChat(deps: EventSubChatDeps): ChatSourceFactory {
  return (listener) => new ChatWatcher({ ...deps, ...listener })
}

export type ChatConnectionLostReason =
  | "closed"
  | "keepalive-missed"
  | "handshake-timeout"
  | "malformed-message"
  | "max-age"
  | "revoked"

/** A connection that ended or went silent; the cause of a retry and of giving up. */
export class ChatConnectionLost extends Error {
  constructor(readonly reason: ChatConnectionLostReason) {
    super("EventSub connection lost")
  }
}

/** How many handed-on message ids the watcher keeps to drop a message Twitch sends again. */
const handedOnIdsKept = 1000

/** A connection that has not yet subscribed; `keepaliveMs` is null until Twitch's welcome. */
interface Handshake {
  readonly socket: TextSocket
  /** Connected to a `session_reconnect` URL, which keeps the old session and its subscription. */
  readonly resumed: boolean
  deadline: Instant
  keepaliveMs: number | null
  /** A `session_reconnect` that came before the subscription answered; followed once the connection is live. */
  reconnectUrl: string | null
}

interface Live {
  readonly socket: TextSocket
  readonly since: Instant
  readonly keepaliveMs: number
  lastSeenAt: Instant
}

/**
 * Keeps one EventSub WebSocket subscribed to a channel's chat messages and the other topics the owner asks for. It has no timers: the owner calls
 * {@link ChatWatcher.onAlarm} at {@link ChatWatcher.wakeAt}, which drives the keepalive check, the retry
 * after a failure and the replacement of a connection before it reaches its maximum age.
 */
export class ChatWatcher implements ChatSource {
  private running = false
  private handshake: Handshake | null = null
  private live: Live | null = null
  private attempts = 0
  private retryAt: Instant | null = null
  /** Replacing the live connection kept failing; it serves until it drops or reaches its maximum age. */
  private replacementGivenUp = false
  /** The ids of the last messages handed on, oldest first. */
  private readonly handedOn = new Set<string>()

  constructor(private readonly deps: ChatWatcherDeps) {}

  /** Starts watching; a watcher that already runs is left alone. */
  open(): void {
    if (this.running) return
    this.running = true
    this.attempts = 0
    this.replacementGivenUp = false
    this.connect(this.newSessionUrl(), false)
  }

  /** Stops watching and closes every socket; a closed watcher is left alone. */
  close(): void {
    if (!this.running) return
    this.running = false
    this.retryAt = null
    this.replacementGivenUp = false
    this.handshake?.socket.close()
    this.live?.socket.close()
    this.handshake = null
    this.live = null
  }

  /** The next instant {@link ChatWatcher.onAlarm} has work, `null` while closed. */
  wakeAt(): Instant | null {
    if (!this.running) return null
    const wakes: Instant[] = []
    if (this.handshake !== null) wakes.push(this.handshake.deadline)
    if (this.live !== null) {
      wakes.push(this.keepaliveDeadline(this.live), this.maxAgeAt(this.live))
    }
    const replaceable = this.replaceableLive()
    if (this.retryAt !== null) wakes.push(this.retryAt)
    else if (replaceable !== null) wakes.push(this.replaceAt(replaceable))
    return wakes.length === 0 ? null : Math.min(...wakes)
  }

  onAlarm(): void {
    if (!this.running) return
    const now = this.deps.clock.now()
    if (this.handshake !== null && now >= this.handshake.deadline) {
      this.dropHandshake()
      this.retry(new ChatConnectionLost("handshake-timeout"))
    }
    if (this.live !== null && now >= this.keepaliveDeadline(this.live)) {
      this.dropLive()
      this.retry(new ChatConnectionLost("keepalive-missed"))
    }
    if (this.live !== null && now >= this.maxAgeAt(this.live)) {
      this.dropLive()
      this.retry(new ChatConnectionLost("max-age"))
    }
    if (!this.running || this.handshake !== null) return
    const replaceable = this.replaceableLive()
    const due =
      this.retryAt === null
        ? replaceable !== null && now >= this.replaceAt(replaceable)
        : now >= this.retryAt
    if (!due) return
    this.retryAt = null
    this.connect(this.newSessionUrl(), false)
  }

  private connect(url: string, resumed: boolean): void {
    this.dropHandshake()
    const socket: TextSocket = this.deps.connector.open(url, {
      onText: (text) => this.onText(socket, text),
      onClose: (cause) => this.onClose(socket, cause),
    })
    this.handshake = {
      socket,
      resumed,
      deadline: this.handshakeDeadline(),
      keepaliveMs: null,
      reconnectUrl: null,
    }
  }

  private onText(socket: TextSocket, text: string): void {
    const handshake = this.handshake?.socket === socket ? this.handshake : null
    const live = this.live?.socket === socket ? this.live : null
    if (handshake === null && live === null) return
    const parsed = parseEventSubMessage(text)
    if (!parsed.ok) {
      this.lose(socket, new ChatConnectionLost("malformed-message"))
      return
    }
    const message = parsed.value
    switch (message.kind) {
      case "welcome":
        if (handshake !== null && handshake.keepaliveMs === null) {
          this.welcomed(handshake, message.sessionId, message.keepaliveSeconds * 1000)
        }
        return
      case "keepalive":
        if (live !== null) live.lastSeenAt = this.deps.clock.now()
        return
      case "notification":
        if (!this.delivers(live, handshake)) return
        if (live !== null) live.lastSeenAt = this.deps.clock.now()
        if (this.firstDelivery(message.messageId)) this.deps.onMessage(message.chat)
        return
      case "channel-entry":
        if (!this.delivers(live, handshake)) return
        if (live !== null) live.lastSeenAt = this.deps.clock.now()
        if (this.firstDelivery(message.messageId)) this.deps.onChannelEntry(message.event)
        return
      case "reconnect":
        if (live !== null) this.connect(message.url, true)
        else if (handshake !== null) handshake.reconnectUrl = message.url
        return
      case "revoked":
        if (live !== null) this.giveUp(new ChatConnectionLost("revoked"))
        return
      case "ignored":
        return
    }
  }

  /**
   * Events count from the live connection, and from a subscribing one while none is live: Twitch can send an event
   * before its answer to the subscription arrives. During a replacement the live connection still carries them. A
   * subscription refused later keeps them: Twitch sends nothing for a subscription it did not create.
   */
  private delivers(live: Live | null, handshake: Handshake | null): boolean {
    return live !== null || (handshake !== null && this.live === null)
  }

  /** Twitch delivers at least once and sends a message again with its id; each id is handed on once. */
  private firstDelivery(messageId: string): boolean {
    if (this.handedOn.has(messageId)) return false
    this.handedOn.add(messageId)
    // A Set iterates in insertion order, so the first id is the oldest.
    for (const oldest of this.handedOn) {
      if (this.handedOn.size <= handedOnIdsKept) break
      this.handedOn.delete(oldest)
    }
    return true
  }

  private onClose(socket: TextSocket, cause: unknown): void {
    this.lose(socket, cause ?? new ChatConnectionLost("closed"))
  }

  /** A socket that ended or broke: forget it and retry; a socket the watcher already dropped is ignored. */
  private lose(socket: TextSocket, cause: unknown): void {
    if (this.live?.socket === socket) this.live = null
    else if (this.handshake?.socket === socket) this.handshake = null
    else return
    socket.close()
    this.retry(cause)
  }

  private welcomed(handshake: Handshake, sessionId: string, keepaliveMs: number): void {
    handshake.keepaliveMs = keepaliveMs
    if (handshake.resumed) {
      this.promote(handshake, keepaliveMs)
      return
    }
    handshake.deadline = this.handshakeDeadline()
    void this.deps.subscribe(sessionId, this.deps.topics()).then(
      (refused) => {
        if (this.handshake !== handshake) return
        this.promote(handshake, keepaliveMs)
        for (const refusal of refused) this.deps.onChannelEntryUnavailable(refusal)
      },
      (cause: unknown) => {
        if (this.handshake !== handshake) return
        // A refused replacement must not end a connection that still works.
        if (this.live === null) {
          this.giveUp(cause)
          return
        }
        this.dropHandshake()
        this.retry(cause)
      },
    )
  }

  private promote(handshake: Handshake, keepaliveMs: number): void {
    const previous = this.live
    const now = this.deps.clock.now()
    this.live = { socket: handshake.socket, since: now, keepaliveMs, lastSeenAt: now }
    this.handshake = null
    this.attempts = 0
    this.retryAt = null
    this.replacementGivenUp = false
    previous?.socket.close()
    if (handshake.reconnectUrl !== null) this.connect(handshake.reconnectUrl, true)
    this.deps.onSchedule()
  }

  // The slot is cleared before the socket closes, so the close event of a dropped socket is not a second failure.
  private dropHandshake(): void {
    const { handshake } = this
    this.handshake = null
    handshake?.socket.close()
  }

  private dropLive(): void {
    const { live } = this
    this.live = null
    live?.socket.close()
  }

  private retry(cause: unknown): void {
    if (!this.running) return
    this.attempts += 1
    if (this.attempts > this.deps.config.eventSubReconnectMaxAttempts) {
      // A pending connection can still take over; giving up waits for it to fail too.
      if (this.live === null && this.handshake === null) {
        this.giveUp(cause)
        return
      }
      this.replacementGivenUp = true
      this.retryAt = null
      return
    }
    this.retryAt = this.deps.clock.now() + this.deps.config.eventSubReconnectDelaySeconds * 1000
    this.deps.onSchedule()
  }

  private giveUp(cause: unknown): void {
    this.close()
    this.deps.onUnavailable(cause)
  }

  /** A `session_reconnect` URL Twitch sends keeps the session's keepalive timeout, so only a new session asks for it. */
  private newSessionUrl(): string {
    const { eventSubUrl, eventSubKeepaliveSeconds } = this.deps.config
    const url = new URL(eventSubUrl)
    url.searchParams.set("keepalive_timeout_seconds", String(eventSubKeepaliveSeconds))
    return url.toString()
  }

  private handshakeDeadline(): Instant {
    return this.deps.clock.now() + this.deps.config.eventSubSubscribeSeconds * 1000
  }

  private keepaliveDeadline(live: Live): Instant {
    return (
      live.lastSeenAt + live.keepaliveMs + this.deps.config.eventSubKeepaliveGraceSeconds * 1000
    )
  }

  /** The live connection when it is due a planned replacement, `null` while one is underway or given up. */
  private replaceableLive(): Live | null {
    return this.handshake === null && !this.replacementGivenUp ? this.live : null
  }

  private maxAgeAt(live: Live): Instant {
    return live.since + this.deps.config.eventSubConnectionMaxSeconds * 1000
  }

  private replaceAt(live: Live): Instant {
    const { eventSubConnectionMaxSeconds, eventSubReconnectMarginSeconds } = this.deps.config
    return live.since + (eventSubConnectionMaxSeconds - eventSubReconnectMarginSeconds) * 1000
  }
}
