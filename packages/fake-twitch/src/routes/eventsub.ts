import { Hono } from "hono"
import { upgradeWebSocket } from "@hono/bun"
import type { WSContext } from "hono/ws"
import type { HelixEnv } from "../lib/auth.ts"
import { helixError, scriptedHelixFailure } from "../lib/responses.ts"
import { pairKey, requireUser, type FakeState } from "../state.ts"
import { tierVersionIds } from "./helix.ts"

export interface EventSub {
  socketRoutes: Hono
  subscriptionRoutes: Hono<HelixEnv>
  sendChatMessage(broadcasterId: string, chatterUserId: string, text: string): void
  reconnect(): void
  revokeSubscriptions(): void
  /** EventSub sockets that are open now. */
  connectionCount(): number
  /** Chat subscriptions on the open sockets. */
  subscriptionCount(): number
}

const chatMessageType = "channel.chat.message"
/** Twitch close code for a socket that sent no subscription in time. */
const closeConnectionUnused = 4003

interface Subscription {
  id: string
  broadcasterId: string
  userId: string
  createdAt: string
}

interface Session {
  id: string
  ws: WSContext
  /** `ws://` URL a client reconnects to, built from the URL the socket was opened on. */
  reconnectUrl: URL
  subscriptions: Subscription[]
  keepalive: ReturnType<typeof setInterval>
  subscribeWindow: ReturnType<typeof setTimeout>
}

interface SubscribeRequest {
  broadcasterId: string
  userId: string
  sessionId: string
}

export function createEventSub(state: FakeState): EventSub {
  const sessions = new Map<string, Session>()
  // A socket that a `session_reconnect` replaced stays open until its client closes it, so it is not in `sessions`.
  const open = new Set<Session>()
  const socketRoutes = new Hono()
  const subscriptionRoutes = new Hono<HelixEnv>()

  socketRoutes.get(
    "/ws",
    upgradeWebSocket((c) => {
      const url = new URL(c.req.url)
      let session: Session | undefined
      return {
        onOpen: (_event, ws) => {
          session = openSession(ws, url)
        },
        onClose: () => {
          if (session !== undefined) closeSession(session)
        },
      }
    }),
  )

  subscriptionRoutes.post("/subscriptions", async (c) => {
    const failure = scriptedHelixFailure(c, state, "eventsub")
    if (failure) return failure

    const request = parseSubscribeRequest(await c.req.json().catch((): unknown => undefined))
    if (request === undefined) return helixError(c, 400, "Invalid subscription request")
    const token = c.get("token")
    if (token.userId !== request.userId || !token.scopes.includes("user:read:chat")) {
      return helixError(c, 403, "subscription missing proper authorization")
    }
    const session = sessions.get(request.sessionId)
    if (session === undefined) {
      return helixError(
        c,
        400,
        "The websocket transport session does not exist or has already disconnected",
      )
    }

    const subscription: Subscription = {
      id: crypto.randomUUID(),
      broadcasterId: request.broadcasterId,
      userId: request.userId,
      createdAt: new Date().toISOString(),
    }
    session.subscriptions.push(subscription)
    return c.json(
      {
        data: [subscriptionJson(subscription, session.id)],
        total: 1,
        total_cost: 0,
        max_total_cost: 10,
      },
      202,
    )
  })

  return {
    socketRoutes,
    subscriptionRoutes,
    sendChatMessage(broadcasterId, chatterUserId, text) {
      const broadcaster = requireUser(state, broadcasterId)
      const chatter = requireUser(state, chatterUserId)
      for (const session of sessions.values()) {
        for (const subscription of session.subscriptions) {
          if (subscription.broadcasterId !== broadcasterId) continue
          send(session.ws, {
            metadata: {
              ...metadata("notification"),
              subscription_type: chatMessageType,
              subscription_version: "1",
            },
            payload: {
              subscription: subscriptionJson(subscription, session.id),
              event: {
                broadcaster_user_id: broadcaster.id,
                broadcaster_user_login: broadcaster.login,
                broadcaster_user_name: broadcaster.displayName,
                chatter_user_id: chatter.id,
                chatter_user_login: chatter.login,
                chatter_user_name: chatter.displayName,
                message_id: crypto.randomUUID(),
                message: {
                  text,
                  fragments: [{ type: "text", text, cheermote: null, emote: null, mention: null }],
                },
                message_type: "text",
                badges: chatBadges(state, broadcaster.id, chatter.id),
                color: "",
                cheer: null,
                reply: null,
                channel_points_custom_reward_id: null,
              },
            },
          })
        }
      }
    },
    revokeSubscriptions() {
      for (const session of open) {
        for (const subscription of session.subscriptions.splice(0)) {
          send(session.ws, {
            metadata: {
              ...metadata("revocation"),
              subscription_type: chatMessageType,
              subscription_version: "1",
            },
            payload: {
              subscription: {
                ...subscriptionJson(subscription, session.id),
                status: "authorization_revoked",
              },
            },
          })
        }
      }
    },
    connectionCount: () => open.size,
    subscriptionCount: () =>
      [...open].reduce((count, session) => count + session.subscriptions.length, 0),
    reconnect() {
      for (const session of sessions.values()) {
        send(session.ws, {
          metadata: metadata("session_reconnect"),
          payload: {
            session: {
              id: session.id,
              status: "reconnecting",
              keepalive_timeout_seconds: null,
              reconnect_url: session.reconnectUrl.toString(),
              connected_at: new Date().toISOString(),
            },
          },
        })
      }
    },
  }

  function openSession(ws: WSContext, url: URL): Session {
    const previous = sessions.get(url.searchParams.get("reconnect_session") ?? "")
    const id = previous?.id ?? crypto.randomUUID()
    const reconnectUrl = new URL(url)
    reconnectUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    reconnectUrl.searchParams.set("reconnect_session", id)
    const { keepaliveTimeoutSeconds, subscribeWindowMs } = state.options

    const session: Session = {
      id,
      ws,
      reconnectUrl,
      subscriptions: previous?.subscriptions.splice(0) ?? [],
      keepalive: setInterval(
        () => send(ws, { metadata: metadata("session_keepalive"), payload: {} }),
        (keepaliveTimeoutSeconds * 1000) / 2,
      ),
      subscribeWindow: setTimeout(() => {
        if (session.subscriptions.length === 0) ws.close(closeConnectionUnused, "connection unused")
      }, subscribeWindowMs),
    }
    sessions.set(id, session)
    open.add(session)
    send(ws, {
      metadata: metadata("session_welcome"),
      payload: {
        session: {
          id,
          status: "connected",
          connected_at: new Date().toISOString(),
          keepalive_timeout_seconds: keepaliveTimeoutSeconds,
          reconnect_url: null,
        },
      },
    })
    return session
  }

  function closeSession(session: Session): void {
    clearInterval(session.keepalive)
    clearTimeout(session.subscribeWindow)
    open.delete(session)
    if (sessions.get(session.id) === session) sessions.delete(session.id)
  }
}

function send(ws: WSContext, message: object): void {
  ws.send(JSON.stringify(message))
}

function metadata(messageType: string) {
  return {
    message_id: crypto.randomUUID(),
    message_type: messageType,
    message_timestamp: new Date().toISOString(),
  }
}

// The badges Twitch puts on a message from what the fake knows: the broadcaster, the channel roles and the subscription.
function chatBadges(state: FakeState, broadcasterId: string, chatterId: string) {
  const badges: { set_id: string; id: string; info: string }[] = []
  if (chatterId === broadcasterId) badges.push({ set_id: "broadcaster", id: "1", info: "" })
  if (state.roles.moderator.get(broadcasterId)?.has(chatterId) === true) {
    badges.push({ set_id: "moderator", id: "1", info: "" })
  }
  if (state.roles.vip.get(broadcasterId)?.has(chatterId) === true) {
    badges.push({ set_id: "vip", id: "1", info: "" })
  }
  const tier = state.subscriptions.get(pairKey(broadcasterId, chatterId))
  if (tier !== undefined) {
    badges.push({ set_id: "subscriber", id: tierVersionIds[tier], info: "1" })
  }
  return badges
}

function subscriptionJson(subscription: Subscription, sessionId: string) {
  return {
    id: subscription.id,
    status: "enabled",
    type: chatMessageType,
    version: "1",
    condition: { broadcaster_user_id: subscription.broadcasterId, user_id: subscription.userId },
    transport: { method: "websocket", session_id: sessionId },
    created_at: subscription.createdAt,
    cost: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseSubscribeRequest(body: unknown): SubscribeRequest | undefined {
  if (!isRecord(body) || body.type !== chatMessageType || body.version !== "1") return undefined
  const { condition, transport } = body
  if (!isRecord(condition) || !isRecord(transport) || transport.method !== "websocket")
    return undefined
  const { broadcaster_user_id: broadcasterId, user_id: userId } = condition
  const sessionId = transport.session_id
  if (
    typeof broadcasterId !== "string"
    || typeof userId !== "string"
    || typeof sessionId !== "string"
  ) {
    return undefined
  }
  return { broadcasterId, userId, sessionId }
}
