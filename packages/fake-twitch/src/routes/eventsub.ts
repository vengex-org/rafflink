import { Hono } from "hono"
import { upgradeWebSocket } from "@hono/bun"
import type { WSContext } from "hono/ws"
import type { HelixEnv } from "../lib/auth.ts"
import { helixError, scriptedHelixFailure } from "../lib/responses.ts"
import { pairKey, requireUser, type FakeState, type FakeUser, type Tier } from "../state.ts"
import { tierVersionIds } from "./helix.ts"

export interface EventSub {
  socketRoutes: Hono
  subscriptionRoutes: Hono<HelixEnv>
  sendChatMessage(broadcasterId: string, chatterUserId: string, text: string): void
  sendSubscription(broadcasterId: string, userId: string, kind: SubscriptionKind, tier: Tier): void
  sendRedemption(broadcasterId: string, userId: string, rewardId: string): void
  reconnect(): void
  revokeSubscriptions(): void
  /** EventSub sockets that are open now. */
  connectionCount(): number
  /** Subscriptions of every type on the open sockets. */
  subscriptionCount(): number
}

/** A new sub, a resub (its chat message), or a gift sub received: Twitch sends `channel.subscribe` for the recipient of a gift. */
export type SubscriptionKind = "new" | "resub" | "gift"

const chatMessageType = "channel.chat.message"
const subscribeType = "channel.subscribe"
const resubscribeType = "channel.subscription.message"
const redemptionType = "channel.channel_points_custom_reward_redemption.add"

/** The scope each subscription type needs, as Twitch documents it. */
const typeScopes: Readonly<Record<string, string>> = {
  [chatMessageType]: "user:read:chat",
  [subscribeType]: "channel:read:subscriptions",
  [resubscribeType]: "channel:read:subscriptions",
  [redemptionType]: "channel:read:redemptions",
}
/** Twitch close code for a socket that sent no subscription in time. */
const closeConnectionUnused = 4003

interface Subscription {
  id: string
  type: string
  condition: Record<string, string>
  broadcasterId: string
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
  type: string
  condition: Record<string, string>
  broadcasterId: string
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
    const userId = request.condition.user_id ?? request.broadcasterId
    if (token.userId !== userId || !token.scopes.includes(typeScopes[request.type] ?? "")) {
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
      type: request.type,
      condition: request.condition,
      broadcasterId: request.broadcasterId,
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
      notify(broadcasterId, chatMessageType, () => true, {
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
      })
    },
    sendSubscription(broadcasterId, userId, kind, tier) {
      const user = requireUser(state, userId)
      const event = {
        ...broadcasterFields(requireUser(state, broadcasterId)),
        user_id: user.id,
        user_login: user.login,
        user_name: user.displayName,
        tier,
      }
      if (kind === "resub") {
        notify(broadcasterId, resubscribeType, () => true, {
          ...event,
          message: { text: "", emotes: null },
          cumulative_months: 2,
          streak_months: null,
          duration_months: 1,
        })
      } else {
        notify(broadcasterId, subscribeType, () => true, { ...event, is_gift: kind === "gift" })
      }
    },
    sendRedemption(broadcasterId, userId, rewardId) {
      const user = requireUser(state, userId)
      const reward = state.customRewards.get(broadcasterId)?.find((item) => item.id === rewardId)
      if (reward === undefined) throw new Error(`fake Twitch has no reward ${rewardId}`)
      notify(
        broadcasterId,
        redemptionType,
        (subscription) => (subscription.condition.reward_id ?? rewardId) === rewardId,
        {
          ...broadcasterFields(requireUser(state, broadcasterId)),
          id: crypto.randomUUID(),
          user_id: user.id,
          user_login: user.login,
          user_name: user.displayName,
          user_input: "",
          status: "unfulfilled",
          reward: { id: reward.id, title: reward.title, cost: reward.cost, prompt: "" },
          redeemed_at: new Date().toISOString(),
        },
      )
    },
    revokeSubscriptions() {
      for (const session of open) {
        for (const subscription of session.subscriptions.splice(0)) {
          send(session.ws, {
            metadata: {
              ...metadata("revocation"),
              subscription_type: subscription.type,
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

  // Sends the event to every session subscribed to its type on the channel whose subscription `matches`.
  function notify(
    broadcasterId: string,
    type: string,
    matches: (subscription: Subscription) => boolean,
    event: object,
  ): void {
    for (const session of sessions.values()) {
      for (const subscription of session.subscriptions) {
        if (subscription.broadcasterId !== broadcasterId || subscription.type !== type) continue
        if (!matches(subscription)) continue
        send(session.ws, {
          metadata: {
            ...metadata("notification"),
            subscription_type: type,
            subscription_version: "1",
          },
          payload: { subscription: subscriptionJson(subscription, session.id), event },
        })
      }
    }
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

function broadcasterFields(broadcaster: FakeUser) {
  return {
    broadcaster_user_id: broadcaster.id,
    broadcaster_user_login: broadcaster.login,
    broadcaster_user_name: broadcaster.displayName,
  }
}

function subscriptionJson(subscription: Subscription, sessionId: string) {
  return {
    id: subscription.id,
    status: "enabled",
    type: subscription.type,
    version: "1",
    condition: subscription.condition,
    transport: { method: "websocket", session_id: sessionId },
    created_at: subscription.createdAt,
    cost: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// The chat type needs `user_id` in its condition, the others only the channel.
function parseSubscribeRequest(body: unknown): SubscribeRequest | undefined {
  if (!isRecord(body) || typeof body.type !== "string" || body.version !== "1") return undefined
  const { type, condition, transport } = body
  if (!(type in typeScopes)) return undefined
  if (!isRecord(condition) || !isRecord(transport) || transport.method !== "websocket")
    return undefined
  const fields = Object.entries(condition)
  if (!fields.every((field): field is [string, string] => typeof field[1] === "string")) {
    return undefined
  }
  const strings = Object.fromEntries(fields)
  const broadcasterId = strings.broadcaster_user_id
  const sessionId = transport.session_id
  if (broadcasterId === undefined || typeof sessionId !== "string") return undefined
  if (type === chatMessageType && strings.user_id === undefined) return undefined
  return { type, condition: strings, broadcasterId, sessionId }
}
