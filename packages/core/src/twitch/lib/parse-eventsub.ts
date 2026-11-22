import type { Parsed } from "../../lib/parsed.ts"
import type { ChatBadge, ChatMessage } from "../../platform/chat-source.ts"

/** The EventSub WebSocket messages the watcher acts on; any other message type is `ignored`. */
export type EventSubMessage =
  | { readonly kind: "welcome"; readonly sessionId: string; readonly keepaliveSeconds: number }
  | { readonly kind: "keepalive" }
  | { readonly kind: "reconnect"; readonly url: string }
  | { readonly kind: "notification"; readonly chat: ChatMessage }
  /** Twitch removed the chat subscription, for example after the streamer revoked the app. */
  | { readonly kind: "revoked" }
  | { readonly kind: "ignored" }

const malformed: Parsed<never, "malformed"> = { ok: false, issue: "malformed" }
const chatMessageType = "channel.chat.message"

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
      return metadata.subscription_type === chatMessageType
        ? parseChatNotification(payload)
        : { ok: true, value: { kind: "ignored" } }
    case "revocation":
      return {
        ok: true,
        value: { kind: metadata.subscription_type === chatMessageType ? "revoked" : "ignored" },
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

function parseChatNotification(
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
  const badges = parseBadges(event.badges)
  if (badges === null) return malformed
  return {
    ok: true,
    value: {
      kind: "notification",
      chat: { platformUserId, login, displayName, text: message.text, badges },
    },
  }
}

// Twitch writes each badge as `{ set_id, id, info }`; `info` (the months of a sub badge) is not read.
function parseBadges(value: unknown): ChatBadge[] | null {
  if (!Array.isArray(value)) return null
  const badges: ChatBadge[] = []
  for (const badge of value) {
    if (!isRecord(badge) || typeof badge.set_id !== "string" || typeof badge.id !== "string") {
      return null
    }
    badges.push({ setId: badge.set_id, id: badge.id })
  }
  return badges
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
