import { Hono } from "hono"
import { apiRoutes } from "./routes/api.ts"
import { idRoutes } from "./routes/id.ts"
import {
  createSigningKey,
  createState,
  requireUser,
  type Call,
  type FailableEndpoint,
  type FailureStatus,
  type FakeKickOptions,
  type FakeKickReward,
  type FakeKickUser,
  type FakeState,
  type Subscription,
} from "./state.ts"

/** A webhook as Kick sends it, before it is posted: the target URL, the six `Kick-Event-*` headers and the body. */
export interface SignedWebhook {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

/** A chat badge type Kick shows on a message, such as `subscriber` or `moderator`. */
export type FakeKickBadge = "subscriber" | "moderator" | "vip" | "broadcaster" | "sub_gifter"

/** The three subscription events: a new sub, a renewal, and gift subs to one or more recipients. */
export type FakeKickSubscriptionKind = "new" | "renewal" | "gifts"

/** The states a reward redemption is in when Kick sends `channel.reward.redemption.updated`. */
export type FakeKickRedemptionStatus = "pending" | "accepted" | "rejected"

export interface FakeKickControl {
  addUser(user: FakeKickUser): void
  /** The user the next `/oauth/authorize` requests sign in. */
  signInAs(userId: string): void
  /** The next `count` requests to `endpoint` answer `status`. */
  failNext(endpoint: FailableEndpoint, status: FailureStatus, count: number): void
  /** Subscribe calls answer `event` with `error` instead of a subscription, until `null` is passed. */
  refuseEvent(event: string, error: string | null): void
  /** The channel point rewards of the broadcaster's channel. */
  setRewards(broadcasterId: string, rewards: readonly FakeKickReward[]): void
  /** Access and refresh tokens of the user stop working. */
  revokeUserTokens(userId: string): void
  /** Where webhooks are posted, as the webhook URL of the Kick app's settings. */
  setWebhookUrl(url: string): void
  /**
   * Builds the signed `chat.message.sent` webhook of a message in the broadcaster's chat; `null` while no
   * subscription covers the channel or no webhook URL is set. `sentAt` defaults to now.
   */
  chatWebhook(
    broadcasterId: string,
    senderId: string,
    text: string,
    sentAt?: Date,
    badges?: readonly FakeKickBadge[],
  ): Promise<SignedWebhook | null>
  /** Builds and posts {@link chatWebhook}; the target's status, `null` when nothing was sent. */
  sendChatMessage(
    broadcasterId: string,
    senderId: string,
    text: string,
    badges?: readonly FakeKickBadge[],
  ): Promise<number | null>
  /**
   * Builds the signed webhook of a subscription in the broadcaster's channel: `recipientIds` holds the one
   * subscriber of a new sub or renewal, or every recipient of gift subs; `null` as for {@link chatWebhook}.
   */
  subscriptionWebhook(
    broadcasterId: string,
    kind: FakeKickSubscriptionKind,
    recipientIds: readonly string[],
  ): Promise<SignedWebhook | null>
  /** Builds and posts {@link subscriptionWebhook}; the target's status, `null` when nothing was sent. */
  sendSubscription(
    broadcasterId: string,
    kind: FakeKickSubscriptionKind,
    recipientIds: readonly string[],
  ): Promise<number | null>
  /** Builds the signed `channel.reward.redemption.updated` webhook; `null` as for {@link chatWebhook}. */
  redemptionWebhook(
    broadcasterId: string,
    redeemerId: string,
    rewardId: string,
    status: FakeKickRedemptionStatus,
  ): Promise<SignedWebhook | null>
  /** Builds and posts {@link redemptionWebhook}; the target's status, `null` when nothing was sent. */
  sendRedemption(
    broadcasterId: string,
    redeemerId: string,
    rewardId: string,
    status: FakeKickRedemptionStatus,
  ): Promise<number | null>
  /** Signs with a new key from now on and serves its public half, as when Kick rotates its key. */
  rotateKey(): Promise<void>
  /** The subscriptions that exist now. */
  subscriptions(): readonly Subscription[]
  /** Deletes every subscription, as Kick does after a webhook kept failing for a day. */
  dropSubscriptions(): void
  readonly calls: readonly Call[]
}

export interface FakeKick {
  /** Serves `/oauth/*` (id.kick.com) and `/public/v1/*` (api.kick.com) on one origin. */
  app: Hono
  control: FakeKickControl
}

export function createFakeKick(options: FakeKickOptions): FakeKick {
  const state = createState(options)
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
  app.route("/oauth", idRoutes(state))
  app.route("/public/v1", apiRoutes(state))

  const control: FakeKickControl = {
    addUser(user) {
      state.users.set(user.id, user)
    },
    signInAs(userId) {
      state.signInUserId = requireUser(state, userId).id
    },
    failNext(endpoint, status, count) {
      const queue = state.failures.get(endpoint) ?? []
      queue.push(...Array.from({ length: count }, () => status))
      state.failures.set(endpoint, queue)
    },
    refuseEvent(event, error) {
      if (error === null) state.refusedEvents.delete(event)
      else state.refusedEvents.set(event, error)
    },
    setRewards(broadcasterId, rewards) {
      state.rewards.set(broadcasterId, [...rewards])
    },
    revokeUserTokens(userId) {
      for (const token of state.accessTokens.values()) {
        if (token.userId === userId) token.revoked = true
      }
      for (const [refreshToken, grant] of state.refreshTokens) {
        if (grant.userId === userId) state.refreshTokens.delete(refreshToken)
      }
    },
    setWebhookUrl(url) {
      state.webhookUrl = url
    },
    chatWebhook: (broadcasterId, senderId, text, sentAt = new Date(), badges = []) =>
      chatWebhook(state, broadcasterId, senderId, text, sentAt, badges),
    async sendChatMessage(broadcasterId, senderId, text, badges = []) {
      return post(await chatWebhook(state, broadcasterId, senderId, text, new Date(), badges))
    },
    subscriptionWebhook: (broadcasterId, kind, recipientIds) =>
      subscriptionWebhook(state, broadcasterId, kind, recipientIds),
    async sendSubscription(broadcasterId, kind, recipientIds) {
      return post(await subscriptionWebhook(state, broadcasterId, kind, recipientIds))
    },
    redemptionWebhook: (broadcasterId, redeemerId, rewardId, status) =>
      redemptionWebhook(state, broadcasterId, redeemerId, rewardId, status),
    async sendRedemption(broadcasterId, redeemerId, rewardId, status) {
      return post(await redemptionWebhook(state, broadcasterId, redeemerId, rewardId, status))
    },
    async rotateKey() {
      state.signingKey = createSigningKey()
      await state.signingKey
    },
    subscriptions: () => [...state.subscriptions.values()],
    dropSubscriptions() {
      state.subscriptions.clear()
    },
    calls: state.calls,
  }

  return { app, control }
}

async function post(webhook: SignedWebhook | null): Promise<number | null> {
  if (webhook === null) return null
  const response = await fetch(webhook.url, {
    method: "POST",
    headers: webhook.headers,
    body: webhook.body,
  })
  await response.body?.cancel()
  return response.status
}

function chatWebhook(
  state: FakeState,
  broadcasterId: string,
  senderId: string,
  text: string,
  sentAt: Date,
  badges: readonly FakeKickBadge[],
): Promise<SignedWebhook | null> {
  const broadcaster = requireUser(state, broadcasterId)
  const sender = requireUser(state, senderId)
  return signedWebhook(
    state,
    "chat.message.sent",
    broadcasterId,
    sentAt,
    (messageId, timestamp) => ({
      message_id: messageId,
      broadcaster: profileJson(broadcaster, null),
      sender: profileJson(sender, {
        username_color: "#FFFFFF",
        badges: badges.map((type) => ({ text: type, type })),
      }),
      content: text,
      emotes: [],
      created_at: timestamp,
    }),
  )
}

function subscriptionWebhook(
  state: FakeState,
  broadcasterId: string,
  kind: FakeKickSubscriptionKind,
  recipientIds: readonly string[],
): Promise<SignedWebhook | null> {
  const broadcaster = profileJson(requireUser(state, broadcasterId), null)
  const recipients = recipientIds.map((id) => profileJson(requireUser(state, id), null))
  const event = `channel.subscription.${kind}`
  return signedWebhook(state, event, broadcasterId, new Date(), (_messageId, timestamp) =>
    kind === "gifts"
      ? {
          broadcaster,
          gifter: { ...anonymousUser, is_anonymous: true },
          giftees: recipients,
          created_at: timestamp,
          expires_at: timestamp,
        }
      : {
          broadcaster,
          subscriber: recipients[0] ?? null,
          duration: 1,
          created_at: timestamp,
          expires_at: timestamp,
        },
  )
}

function redemptionWebhook(
  state: FakeState,
  broadcasterId: string,
  redeemerId: string,
  rewardId: string,
  status: FakeKickRedemptionStatus,
): Promise<SignedWebhook | null> {
  const broadcaster = requireUser(state, broadcasterId)
  const redeemer = requireUser(state, redeemerId)
  const reward = state.rewards.get(broadcasterId)?.find((candidate) => candidate.id === rewardId)
  return signedWebhook(
    state,
    "channel.reward.redemption.updated",
    broadcasterId,
    new Date(),
    (_messageId, timestamp) => ({
      id: crypto.randomUUID(),
      user_input: "",
      status,
      redeemed_at: timestamp,
      reward: {
        id: rewardId,
        title: reward?.title ?? "Reward",
        cost: reward?.cost ?? 0,
        description: "",
      },
      redeemer: redemptionUserJson(redeemer),
      broadcaster: redemptionUserJson(broadcaster),
    }),
  )
}

// Signs `${messageId}.${timestamp}.${body}` as Kick does; `null` while no subscription of the event covers the channel.
async function signedWebhook(
  state: FakeState,
  event: string,
  broadcasterId: string,
  sentAt: Date,
  bodyOf: (messageId: string, timestamp: string) => unknown,
): Promise<SignedWebhook | null> {
  const subscription = [...state.subscriptions.values()].find(
    (candidate) => candidate.broadcasterId === broadcasterId && candidate.event === event,
  )
  if (subscription === undefined || state.webhookUrl === null) return null
  const messageId = crypto.randomUUID()
  const timestamp = sentAt.toISOString()
  const body = JSON.stringify(bodyOf(messageId, timestamp))
  const { privateKey } = await state.signingKey
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${messageId}.${timestamp}.${body}`),
  )
  return {
    url: state.webhookUrl,
    headers: {
      "Content-Type": "application/json",
      "Kick-Event-Message-Id": messageId,
      "Kick-Event-Subscription-Id": subscription.id,
      "Kick-Event-Signature": Buffer.from(signature).toString("base64"),
      "Kick-Event-Message-Timestamp": timestamp,
      "Kick-Event-Type": event,
      "Kick-Event-Version": String(subscription.version),
    },
    body,
  }
}

const anonymousUser = {
  user_id: null,
  username: null,
  is_verified: null,
  profile_picture: null,
  channel_slug: null,
  identity: null,
}

function profileJson(user: FakeKickUser, identity: unknown) {
  return {
    is_anonymous: false,
    user_id: Number(user.id),
    username: user.name,
    is_verified: false,
    profile_picture: "",
    channel_slug: user.name.toLowerCase(),
    identity,
  }
}

// The redemption event's users carry no `is_anonymous` or `identity`.
function redemptionUserJson(user: FakeKickUser) {
  return {
    user_id: Number(user.id),
    username: user.name,
    is_verified: false,
    profile_picture: "",
    channel_slug: user.name.toLowerCase(),
  }
}
