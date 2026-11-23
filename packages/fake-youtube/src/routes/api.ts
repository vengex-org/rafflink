import { Hono, type Context } from "hono"
import { createMiddleware } from "hono/factory"
import {
  activeChat,
  takeFailure,
  type AccessToken,
  type FailableEndpoint,
  type FakeState,
} from "../state.ts"

type ApiEnv = { Variables: { token: AccessToken } }

const readonlyScope = "https://www.googleapis.com/auth/youtube.readonly"

/** The YouTube Data API v3 calls Rafflink makes: the signed-in channel, its active broadcast and its live chat. */
export function apiRoutes(state: FakeState): Hono {
  const app = new Hono()
  const auth = bearerAuth(state)

  app.get("/channels", auth, (c) => {
    const failed = scriptedFailure(c, state, "channels")
    if (failed !== undefined) return failed
    if (c.req.query("mine") !== "true") return apiError(c, 400, "missingRequiredParameter")
    const { channelId } = c.get("token")
    const channel = channelId === null ? undefined : state.channels.get(channelId)
    // YouTube leaves `items` out for an account without a channel.
    if (channel === undefined) return c.json({ kind: "youtube#channelListResponse", pageInfo: {} })
    return c.json({
      kind: "youtube#channelListResponse",
      items: [
        {
          kind: "youtube#channel",
          id: channel.id,
          snippet: {
            title: channel.title,
            ...(channel.handle === null ? {} : { customUrl: channel.handle }),
          },
        },
      ],
    })
  })

  app.get("/liveBroadcasts", auth, (c) => {
    const failed = scriptedFailure(c, state, "live-broadcasts")
    if (failed !== undefined) return failed
    // YouTube takes exactly one filter: `mine`, `id` or `broadcastStatus`.
    if (c.req.query("broadcastStatus") !== "active" || c.req.query("mine") !== undefined) {
      return apiError(c, 400, "incompatibleParameters")
    }
    const { channelId } = c.get("token")
    const chat = channelId === null ? undefined : activeChat(state, channelId)
    return c.json({
      kind: "youtube#liveBroadcastListResponse",
      items:
        chat === undefined
          ? []
          : [
              {
                kind: "youtube#liveBroadcast",
                id: `b-${chat.id}`,
                snippet: { liveChatId: chat.id },
              },
            ],
    })
  })

  app.get("/liveChat/messages", auth, (c) => {
    const failed = scriptedFailure(c, state, "live-chat-messages")
    if (failed !== undefined) return failed
    const chat = state.chats.get(c.req.query("liveChatId") ?? "")
    if (chat === undefined) return apiError(c, 404, "liveChatNotFound")
    if (chat.ended) return apiError(c, 403, "liveChatEnded")
    const start = Number(c.req.query("pageToken") ?? "0")
    const items = chat.items.filter((item) => item.position >= start)
    return c.json({
      kind: "youtube#liveChatMessageListResponse",
      pollingIntervalMillis: state.pollingIntervalMillis,
      nextPageToken: String(chat.items.length),
      pageInfo: { totalResults: items.length, resultsPerPage: items.length },
      items: items.map((item) => {
        const author = state.channels.get(item.authorChannelId)
        return {
          kind: "youtube#liveChatMessage",
          id: `m-${chat.id}-${item.position}`,
          snippet: {
            type: "textMessageEvent",
            liveChatId: chat.id,
            authorChannelId: item.authorChannelId,
            publishedAt: item.publishedAt,
            hasDisplayContent: true,
            displayMessage: item.text,
            textMessageDetails: { messageText: item.text },
          },
          authorDetails: {
            channelId: item.authorChannelId,
            channelUrl: `http://www.youtube.com/channel/${item.authorChannelId}`,
            displayName: author?.handle ?? author?.title ?? item.authorChannelId,
            profileImageUrl: "https://yt3.ggpht.com/fake",
            isVerified: false,
            isChatOwner: item.isChatOwner,
            isChatSponsor: item.isChatSponsor,
            isChatModerator: item.isChatModerator,
          },
        }
      }),
    })
  })

  return app
}

function bearerAuth(state: FakeState) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const header = c.req.header("Authorization") ?? ""
    const token = header.startsWith("Bearer ")
      ? state.accessTokens.get(header.slice("Bearer ".length))
      : undefined
    if (token === undefined || token.revoked) return apiError(c, 401, "authError")
    if (!token.scopes.includes(readonlyScope)) return apiError(c, 403, "insufficientPermissions")
    c.set("token", token)
    return next()
  })
}

function scriptedFailure(c: Context, state: FakeState, endpoint: FailableEndpoint) {
  const failure = takeFailure(state, endpoint)
  return failure === undefined ? undefined : apiError(c, failure.status, failure.reason)
}

// YouTube's error body: the reason the client acts on sits in `errors[0].reason`.
function apiError(c: Context, status: 400 | 401 | 403 | 404 | 429 | 500 | 503, reason: string) {
  return c.json(
    {
      error: {
        code: status,
        message: reason,
        errors: [{ domain: "youtube", reason, message: reason }],
      },
    },
    status,
  )
}
