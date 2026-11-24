import type { Parsed } from "../../lib/parsed.ts"
import { isTier, tierLevels } from "./parse-response.ts"
import type {
  ChannelEntryEvent,
  ChannelViewer,
  ChatMessage,
  ChatterRoles,
} from "../../platform/chat-source.ts"

/** The EventSub WebSocket messages the watcher acts on; any other message type is `ignored`. */
export type EventSubMessage =
  | { readonly kind: "welcome"; readonly sessionId: string; readonly keepaliveSeconds: number }
  | { readonly kind: "keepalive" }
  | { readonly kind: "reconnect"; readonly url: string }
  /** `messageId` is the same when Twitch sends a message again. */
  | { readonly kind: "notification"; readonly messageId: string; readonly chat: ChatMessage }
  | {
      readonly kind: "channel-entry"
      readonly messageId: string
      readonly event: ChannelEntryEvent
    }
  /** Twitch removed one of the watch's subscriptions, for example after the streamer revoked the app. */
  | { readonly kind: "revoked" }
  | { readonly kind: "ignored" }

const malformed: Parsed<never, "malformed"> = { ok: false, issue: "malformed" }
/** The EventSub subscription types the watcher creates. */
export const eventSubTypes = {
  chat: "channel.chat.message",
  subscribe: "channel.subscribe",
  resubscribe: "channel.subscription.message",
  redemption: "channel.channel_points_custom_reward_redemption.add",
} as const

const watchedTypes: readonly unknown[] = Object.values(eventSubTypes)

export function parseEventSubMessage(text: string): Parsed<EventSubMessage, "malformed"> {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return malformed
  }
  if (!isRecord(body) || !isRecord(body.metadata) || !isRecord(body.payload)) return malformed
  const { metadata, payload } = body
  switch (metadata.message_type) {
    case "session_welcome":
      return parseWelcome(payload)
    case "session_keepalive":
      return { ok: true, value: { kind: "keepalive" } }
    case "session_reconnect":
      return parseReconnect(payload)
    case "notification":
      if (typeof metadata.message_id !== "string") return malformed
      return parseNotification(metadata.subscription_type, metadata.message_id, payload)
    case "revocation":
      return {
        ok: true,
        value: { kind: watchedTypes.includes(metadata.subscription_type) ? "revoked" : "ignored" },
      }
    default:
      return { ok: true, value: { kind: "ignored" } }
  }
}

function parseWelcome(payload: Record<string, unknown>): Parsed<EventSubMessage, "malformed"> {
  const { session } = payload
  if (!isRecord(session)) return malformed
  const { id, keepalive_timeout_seconds: keepaliveSeconds } = session
  if (typeof id !== "string" || typeof keepaliveSeconds !== "number") return malformed
  if (!Number.isFinite(keepaliveSeconds) || keepaliveSeconds <= 0) return malformed
  return { ok: true, value: { kind: "welcome", sessionId: id, keepaliveSeconds } }
}

function parseReconnect(payload: Record<string, unknown>): Parsed<EventSubMessage, "malformed"> {
  const { session } = payload
  if (!isRecord(session) || typeof session.reconnect_url !== "string") return malformed
  const { reconnect_url: url } = session
  if (!URL.canParse(url)) return malformed
  const { protocol } = new URL(url)
  if (protocol !== "ws:" && protocol !== "wss:") return malformed
  return { ok: true, value: { kind: "reconnect", url } }
}

function parseNotification(
  type: unknown,
  messageId: string,
  payload: Record<string, unknown>,
): Parsed<EventSubMessage, "malformed"> {
  switch (type) {
    case eventSubTypes.chat:
      return parseChatNotification(messageId, payload)
    // A gift sub fires `channel.subscribe` for its recipient, who is the user of the event.
    case eventSubTypes.subscribe:
    case eventSubTypes.resubscribe:
      return parseSubscription(messageId, payload)
    case eventSubTypes.redemption:
      return parseRedemption(messageId, payload)
    default:
      return { ok: true, value: { kind: "ignored" } }
  }
}

function parseSubscription(
  messageId: string,
  payload: Record<string, unknown>,
): Parsed<EventSubMessage, "malformed"> {
  const { event } = payload
  if (!isRecord(event)) return malformed
  const viewer = eventViewer(event)
  const { tier } = event
  if (viewer === null || !isTier(tier)) return malformed
  return {
    ok: true,
    value: {
      kind: "channel-entry",
      messageId,
      event: { via: "sub", viewer, subTier: tierLevels[tier] },
    },
  }
}

function parseRedemption(
  messageId: string,
  payload: Record<string, unknown>,
): Parsed<EventSubMessage, "malformed"> {
  const { event } = payload
  if (!isRecord(event) || !isRecord(event.reward)) return malformed
  const viewer = eventViewer(event)
  const rewardId = event.reward.id
  if (viewer === null || typeof rewardId !== "string") return malformed
  return {
    ok: true,
    value: { kind: "channel-entry", messageId, event: { via: "points", viewer, rewardId } },
  }
}

function eventViewer(event: Record<string, unknown>): ChannelViewer | null {
  const { user_id: platformUserId, user_login: login, user_name: displayName } = event
  if (
    typeof platformUserId !== "string"
    || typeof login !== "string"
    || typeof displayName !== "string"
  ) {
    return null
  }
  return { platformUserId, login, displayName }
}

function parseChatNotification(
  messageId: string,
  payload: Record<string, unknown>,
): Parsed<EventSubMessage, "malformed"> {
  const { event } = payload
  if (!isRecord(event) || !isRecord(event.message)) return malformed
  const {
    chatter_user_id: platformUserId,
    chatter_user_login: login,
    chatter_user_name: displayName,
    message,
  } = event
  if (
    typeof platformUserId !== "string"
    || typeof login !== "string"
    || typeof displayName !== "string"
    || typeof message.text !== "string"
  ) {
    return malformed
  }
  const roles = parseBadges(event.badges)
  if (roles === null) return malformed
  return {
    ok: true,
    value: {
      kind: "notification",
      messageId,
      chat: { platformUserId, login, displayName, text: message.text, roles },
    },
  }
}

// Twitch writes each badge as `{ set_id, id, info }`; `info` (the months of a sub badge) is not read.
function parseBadges(value: unknown): ChatterRoles | null {
  if (!Array.isArray(value)) return null
  let roles: ChatterRoles = { subTier: null, isMember: false, isVip: false, isModerator: false }
  for (const badge of value) {
    if (!isRecord(badge) || typeof badge.set_id !== "string" || typeof badge.id !== "string") {
      return null
    }
    switch (badge.set_id) {
      case "subscriber":
        roles = { ...roles, subTier: subscriberTier(badge.id) }
        break
      // A founder shows this badge instead of the subscriber one while subscribed; it names no tier.
      case "founder":
        roles = { ...roles, subTier: roles.subTier ?? 1 }
        break
      case "vip":
        roles = { ...roles, isVip: true }
        break
      case "moderator":
        roles = { ...roles, isModerator: true }
        break
    }
  }
  return roles
}

// A subscriber badge id counts months, and from tier 2 up starts at the tier: "0", "3" for tier 1, "2000", "2003" for tier 2, "3012" for tier 3.
function subscriberTier(id: string): 1 | 2 | 3 {
  const version = Number(id)
  if (version >= 3000) return 3
  return version >= 2000 ? 2 : 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
