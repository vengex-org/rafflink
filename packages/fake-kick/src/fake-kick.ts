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

export interface FakeKickControl {
  addUser(user: FakeKickUser): void
  /** The user the next `/oauth/authorize` requests sign in. */
  signInAs(userId: string): void
  /** The next `count` requests to `endpoint` answer `status`. */
  failNext(endpoint: FailableEndpoint, status: FailureStatus, count: number): void
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
  ): Promise<SignedWebhook | null>
  /** Builds and posts {@link chatWebhook}; the target's status, `null` when nothing was sent. */
  sendChatMessage(broadcasterId: string, senderId: string, text: string): Promise<number | null>
  /** Signs with a new key from now on and serves its public half, as when Kick rotates its key. */
  rotateKey(): Promise<void>
  /** The subscriptions that exist now. */
  subscriptions(): readonly Subscription[]
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
    chatWebhook: (broadcasterId, senderId, text, sentAt = new Date()) =>
      chatWebhook(state, broadcasterId, senderId, text, sentAt),
    async sendChatMessage(broadcasterId, senderId, text) {
      const webhook = await chatWebhook(state, broadcasterId, senderId, text, new Date())
      if (webhook === null) return null
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: webhook.headers,
        body: webhook.body,
      })
      await response.body?.cancel()
      return response.status
    },
    async rotateKey() {
      state.signingKey = createSigningKey()
      await state.signingKey
    },
    subscriptions: () => [...state.subscriptions.values()],
    calls: state.calls,
  }

  return { app, control }
}

async function chatWebhook(
  state: FakeState,
  broadcasterId: string,
  senderId: string,
  text: string,
  sentAt: Date,
): Promise<SignedWebhook | null> {
  const subscription = [...state.subscriptions.values()].find(
    (candidate) =>
      candidate.broadcasterId === broadcasterId && candidate.event === "chat.message.sent",
  )
  if (subscription === undefined || state.webhookUrl === null) return null
  const broadcaster = requireUser(state, broadcasterId)
  const sender = requireUser(state, senderId)
  const messageId = crypto.randomUUID()
  const timestamp = sentAt.toISOString()
  const body = JSON.stringify({
    message_id: messageId,
    broadcaster: profileJson(broadcaster, null),
    sender: profileJson(sender, { username_color: "#FFFFFF", badges: [] }),
    content: text,
    emotes: [],
    created_at: timestamp,
  })
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
      "Kick-Event-Type": "chat.message.sent",
      "Kick-Event-Version": "1",
    },
    body,
  }
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
