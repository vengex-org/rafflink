import { Hono } from "hono"
import { createEventSub, type SubscriptionKind } from "./routes/eventsub.ts"
import { helixRoutes } from "./routes/helix.ts"
import { idRoutes } from "./routes/id.ts"
import {
  createState,
  pairKey,
  requireUser,
  type Call,
  type FailableEndpoint,
  type FailureStatus,
  type FakeReward,
  type FakeTwitchOptions,
  type FakeUser,
  type IdTokenFault,
  type Role,
  type Tier,
} from "./state.ts"

const seededCreatedAt = "2020-01-01T00:00:00Z"

export function seededLogin(userId: string): string {
  return `seeded_${userId}`
}

/** The picture URL of a fake user, shaped like the ones Twitch serves from its CDN. */
export function profileImageUrlOf(login: string): string {
  return `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`
}

export interface FakeTwitchControl {
  addUser(user: FakeUser): void
  /** Adds `count` users with ids `firstId`, `firstId + 1`, ... and the logins from {@link seededLogin}. */
  seedUsers(count: number, firstId: number): void
  /** The user the next `/oauth2/authorize` requests sign in. */
  signInAs(userId: string): void
  /** `null` removes the subscription. */
  setSubscription(userId: string, broadcasterId: string, tier: Tier | null): void
  setFollowing(userId: string, broadcasterId: string, following: boolean): void
  setRole(broadcasterId: string, userId: string, role: Role, enabled: boolean): void
  /** The subscriber badge images of the channel's own badge set; `null` removes it, so the channel serves none. */
  setChannelSubscriberBadges(
    broadcasterId: string,
    images: Partial<Record<Tier, string>> | null,
  ): void
  /** The next `count` requests to `endpoint` answer `status`. */
  failNext(endpoint: FailableEndpoint, status: FailureStatus, count: number): void
  /** The next id_token the token endpoint signs is wrong in the way `fault` says. */
  tamperNextIdToken(fault: IdTokenFault): void
  /** Access and refresh tokens of the user stop working; `/oauth2/validate` answers 401. */
  revokeUserTokens(userId: string): void
  sendChatMessage(broadcasterId: string, chatterUserId: string, text: string): void
  /** Sends a `channel.subscribe` (new or gift received) or `channel.subscription.message` (resub) event of the channel. */
  sendSubscription(broadcasterId: string, userId: string, kind: SubscriptionKind, tier: Tier): void
  /** Sends a redemption of one of the channel's rewards (see {@link setCustomRewards}). */
  sendRedemption(broadcasterId: string, userId: string, rewardId: string): void
  /** The channel's point rewards; they are listed only while the user is an affiliate or partner. */
  setCustomRewards(broadcasterId: string, rewards: readonly FakeReward[]): void
  /** Sends `session_reconnect` on every open EventSub socket. */
  reconnect(): void
  /** Sends `revocation` for every subscription and drops the subscriptions; the sockets stay open. */
  revokeChatSubscriptions(): void
  /** EventSub sockets that are open now. */
  eventSubConnections(): number
  /** Subscriptions of every type on the open EventSub sockets. */
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
    seedUsers(count, firstId) {
      for (let id = firstId; id < firstId + count; id++) {
        const userId = String(id)
        state.users.set(userId, {
          id: userId,
          login: seededLogin(userId),
          displayName: seededLogin(userId),
          createdAt: seededCreatedAt,
          profileImageUrl: profileImageUrlOf(seededLogin(userId)),
        })
      }
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
    setChannelSubscriberBadges(broadcasterId, images) {
      requireUser(state, broadcasterId)
      if (images === null) state.channelSubscriberBadges.delete(broadcasterId)
      else state.channelSubscriberBadges.set(broadcasterId, images)
    },
    failNext(endpoint, status, count) {
      const queue = state.failures.get(endpoint) ?? []
      queue.push(...Array.from({ length: count }, () => status))
      state.failures.set(endpoint, queue)
    },
    tamperNextIdToken(fault) {
      state.idTokenFaults.push(fault)
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
    sendSubscription: eventSub.sendSubscription,
    sendRedemption: eventSub.sendRedemption,
    setCustomRewards(broadcasterId, rewards) {
      requireUser(state, broadcasterId)
      state.customRewards.set(broadcasterId, [...rewards])
    },
    reconnect: eventSub.reconnect,
    revokeChatSubscriptions: eventSub.revokeSubscriptions,
    eventSubConnections: eventSub.connectionCount,
    eventSubSubscriptions: eventSub.subscriptionCount,
    calls: state.calls,
  }

  return { app, control }
}
