import type { Parsed } from "../../lib/parsed.ts"

/** A chat message as the watcher hands it on: who wrote it and what. Nothing else of the message is read. */
export interface ChatMessage {
  readonly chatterUserId: string
  readonly text: string
}

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
  const { chatter_user_id: chatterUserId, message } = event
  if (typeof chatterUserId !== "string" || typeof message.text !== "string") return malformed
  return {
    ok: true,
    value: { kind: "notification", chat: { chatterUserId, text: message.text } },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
