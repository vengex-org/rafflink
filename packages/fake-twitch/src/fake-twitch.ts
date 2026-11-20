import { Hono } from "hono"
import { createEventSub } from "./routes/eventsub.ts"
import { helixRoutes } from "./routes/helix.ts"
import { idRoutes } from "./routes/id.ts"
import {
  createState,
  pairKey,
  requireUser,
  type Call,
  type FailableEndpoint,
  type FailureStatus,
  type FakeTwitchOptions,
  type FakeUser,
  type Role,
  type Tier,
} from "./state.ts"

export interface FakeTwitchControl {
  addUser(user: FakeUser): void
  /** The user the next `/oauth2/authorize` requests sign in. */
  signInAs(userId: string): void
  /** `null` removes the subscription. */
  setSubscription(userId: string, broadcasterId: string, tier: Tier | null): void
  setFollowing(userId: string, broadcasterId: string, following: boolean): void
  setRole(broadcasterId: string, userId: string, role: Role, enabled: boolean): void
  /** The next `count` requests to `endpoint` answer `status`. */
  failNext(endpoint: FailableEndpoint, status: FailureStatus, count: number): void
  /** Access and refresh tokens of the user stop working; `/oauth2/validate` answers 401. */
  revokeUserTokens(userId: string): void
  sendChatMessage(broadcasterId: string, chatterUserId: string, text: string): void
  /** Sends `session_reconnect` on every open EventSub socket. */
  reconnect(): void
  /** EventSub sockets that are open now. */
  eventSubConnections(): number
  /** Chat subscriptions on the open EventSub sockets. */
  eventSubSubscriptions(): number
  readonly calls: readonly Call[]
}

export interface FakeTwitch {
  /** Serves `/oauth2/*` (id), `/helix/*` and `/eventsub/ws`. Needs `websocket` from this package in `Bun.serve`. */
  app: Hono
  control: FakeTwitchControl
}

export function createFakeTwitch(options: FakeTwitchOptions): FakeTwitch {
  const state = createState(options)
  const eventSub = createEventSub(state)

  const app = new Hono()
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url)
    state.calls.push({
      method: c.req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    })
    await next()
  })
  app.route("/oauth2", idRoutes(state))
  app.route("/helix", helixRoutes(state, eventSub.subscriptionRoutes))
  app.route("/eventsub", eventSub.socketRoutes)

  const control: FakeTwitchControl = {
    addUser(user) {
      state.users.set(user.id, user)
    },
    signInAs(userId) {
      state.signInUserId = requireUser(state, userId).id
    },
    setSubscription(userId, broadcasterId, tier) {
      const key = pairKey(broadcasterId, requireUser(state, userId).id)
      requireUser(state, broadcasterId)
      if (tier === null) state.subscriptions.delete(key)
      else state.subscriptions.set(key, tier)
    },
    setFollowing(userId, broadcasterId, following) {
      const key = pairKey(requireUser(state, userId).id, requireUser(state, broadcasterId).id)
      if (following) state.follows.add(key)
      else state.follows.delete(key)
    },
    setRole(broadcasterId, userId, role, enabled) {
      requireUser(state, broadcasterId)
      requireUser(state, userId)
      const holders = state.roles[role].get(broadcasterId) ?? new Set<string>()
      if (enabled) holders.add(userId)
      else holders.delete(userId)
      state.roles[role].set(broadcasterId, holders)
    },
    failNext(endpoint, status, count) {
      const queue = state.failures.get(endpoint) ?? []
      queue.push(...Array.from({ length: count }, () => status))
      state.failures.set(endpoint, queue)
    },
    revokeUserTokens(userId) {
      for (const token of state.accessTokens.values()) {
        if (token.userId === userId) token.revoked = true
      }
      for (const [refreshToken, grant] of state.refreshTokens) {
        if (grant.userId === userId) state.refreshTokens.delete(refreshToken)
      }
    },
    sendChatMessage: eventSub.sendChatMessage,
    reconnect: eventSub.reconnect,
    eventSubConnections: eventSub.connectionCount,
    eventSubSubscriptions: eventSub.subscriptionCount,
    calls: state.calls,
  }

  return { app, control }
}
