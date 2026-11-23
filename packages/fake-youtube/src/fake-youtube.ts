import { Hono } from "hono"
import { apiRoutes } from "./routes/api.ts"
import { oauthRoutes } from "./routes/oauth.ts"
import {
  activeChat,
  createState,
  requireChannel,
  type Call,
  type FailableEndpoint,
  type FailureStatus,
  type FakeYouTubeChannel,
  type FakeYouTubeOptions,
} from "./state.ts"

/** What a chat message's author is in the channel, as `authorDetails` tells it. */
export interface FakeYouTubeRoles {
  readonly member?: boolean
  readonly moderator?: boolean
  readonly owner?: boolean
}

export interface FakeYouTubeControl {
  addChannel(channel: FakeYouTubeChannel): void
  /** The channel the next `/o/oauth2/v2/auth` requests sign in; null signs in an account without a channel. */
  signInAs(channelId: string | null): void
  /** The next `count` requests to `endpoint` answer `status` with `reason` as the error reason. */
  failNext(endpoint: FailableEndpoint, status: FailureStatus, count: number, reason?: string): void
  /** Starts a broadcast of the channel with a new live chat and returns the chat's id. */
  goLive(channelId: string): string
  /** Ends the channel's broadcast: its chat refuses every further read. */
  endBroadcast(channelId: string): void
  /** Writes a message in the channel's live chat; the channel must be live. `publishedAt` defaults to now. */
  sendChatMessage(
    channelId: string,
    authorChannelId: string,
    text: string,
    roles?: FakeYouTubeRoles,
    publishedAt?: Date,
  ): void
  /** The `pollingIntervalMillis` every chat page answers. */
  setPollingInterval(ms: number): void
  /** Access and refresh tokens of the channel stop working, as when the streamer removes the app's access. */
  revokeTokens(channelId: string): void
  readonly calls: readonly Call[]
}

export interface FakeYouTube {
  /** Serves Google OAuth (`/o/oauth2/v2/auth`, `/token`, `/tokeninfo`) and `/youtube/v3/*` on one origin. */
  app: Hono
  control: FakeYouTubeControl
}

export function createFakeYouTube(options: FakeYouTubeOptions): FakeYouTube {
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
  app.route("/", oauthRoutes(state))
  app.route("/youtube/v3", apiRoutes(state))

  const control: FakeYouTubeControl = {
    addChannel(channel) {
      state.channels.set(channel.id, channel)
    },
    signInAs(channelId) {
      state.signInChannelId = channelId === null ? null : requireChannel(state, channelId).id
    },
    failNext(endpoint, status, count, reason = "backendError") {
      const queue = state.failures.get(endpoint) ?? []
      queue.push(...Array.from({ length: count }, () => ({ status, reason })))
      state.failures.set(endpoint, queue)
    },
    goLive(channelId) {
      requireChannel(state, channelId)
      control.endBroadcast(channelId)
      const id = `chat-${crypto.randomUUID()}`
      state.chats.set(id, { id, ownerChannelId: channelId, items: [], ended: false })
      return id
    },
    endBroadcast(channelId) {
      const chat = activeChat(state, channelId)
      if (chat !== undefined) chat.ended = true
    },
    sendChatMessage(channelId, authorChannelId, text, roles = {}, publishedAt = new Date()) {
      const chat = activeChat(state, channelId)
      if (chat === undefined) throw new Error(`fake YouTube channel ${channelId} is not live`)
      requireChannel(state, authorChannelId)
      chat.items.push({
        position: chat.items.length,
        authorChannelId,
        text,
        publishedAt: publishedAt.toISOString(),
        isChatSponsor: roles.member === true,
        isChatModerator: roles.moderator === true,
        isChatOwner: roles.owner === true,
      })
    },
    setPollingInterval(ms) {
      state.pollingIntervalMillis = ms
    },
    revokeTokens(channelId) {
      for (const token of state.accessTokens.values()) {
        if (token.channelId === channelId) token.revoked = true
      }
      for (const [refreshToken, grant] of state.refreshTokens) {
        if (grant.channelId === channelId) state.refreshTokens.delete(refreshToken)
      }
    },
    calls: state.calls,
  }

  return { app, control }
}
