import { Hono, type Context } from "hono"
import { helixAuth, requireScope, type HelixEnv } from "../lib/auth.ts"
import { helixError, scriptedHelixFailure } from "../lib/responses.ts"
import { pairKey, requireUser, type FakeState, type FakeUser, type Role } from "../state.ts"

/** Twitch caps `first` on paginated endpoints at 100. */
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

const ROLE_ENDPOINTS: Record<Role, { scope: string; failure: "vips" | "moderators" }> = {
  vip: { scope: "channel:read:vips", failure: "vips" },
  moderator: { scope: "moderation:read", failure: "moderators" },
}

export function helixRoutes(state: FakeState, eventSubRoutes: Hono<HelixEnv>): Hono<HelixEnv> {
  const app = new Hono<HelixEnv>()
  app.use("*", helixAuth(state))
  app.route("/eventsub", eventSubRoutes)

  app.get("/subscriptions/user", (c) => {
    const failure = scriptedHelixFailure(c, state, "subscriptions")
    if (failure) return failure
    const missingScope = requireScope(c, "user:read:subscriptions")
    if (missingScope) return missingScope

    const broadcasterId = c.req.query("broadcaster_id")
    const userId = c.req.query("user_id")
    if (broadcasterId === undefined || userId === undefined) {
      return helixError(c, 400, "Missing required parameter broadcaster_id or user_id")
    }
    if (userId !== c.get("token").userId) {
      return helixError(c, 400, "user_id must match the user ID in the access token")
    }
    const tier = state.subscriptions.get(pairKey(broadcasterId, userId))
    const broadcaster = state.users.get(broadcasterId)
    if (tier === undefined || broadcaster === undefined) {
      return helixError(c, 404, "User has not subscribed to the broadcaster")
    }
    return c.json({
      data: [
        {
          broadcaster_id: broadcaster.id,
          broadcaster_login: broadcaster.login,
          broadcaster_name: broadcaster.displayName,
          gifter_id: "",
          gifter_login: "",
          gifter_name: "",
          is_gift: false,
          tier,
        },
      ],
    })
  })

  app.get("/channels/followed", (c) => {
    const failure = scriptedHelixFailure(c, state, "followed")
    if (failure) return failure
    const missingScope = requireScope(c, "user:read:follows")
    if (missingScope) return missingScope

    const broadcasterId = c.req.query("broadcaster_id")
    const userId = c.req.query("user_id")
    if (broadcasterId === undefined || userId === undefined) {
      return helixError(c, 400, "Missing required parameter broadcaster_id or user_id")
    }
    if (userId !== c.get("token").userId) {
      return helixError(c, 400, "user_id must match the user ID in the access token")
    }
    const broadcaster = state.users.get(broadcasterId)
    const followed =
      broadcaster !== undefined && state.follows.has(pairKey(userId, broadcasterId))
        ? broadcaster
        : undefined
    const data =
      followed === undefined
        ? []
        : [
            {
              broadcaster_id: followed.id,
              broadcaster_login: followed.login,
              broadcaster_name: followed.displayName,
              followed_at: followed.createdAt,
            },
          ]
    return c.json({ total: data.length, data, pagination: {} })
  })

  app.get("/users", (c) => {
    const failure = scriptedHelixFailure(c, state, "users")
    if (failure) return failure

    const ids = c.req.queries("id") ?? []
    const logins = c.req.queries("login") ?? []
    const requested = [...state.users.values()].filter(
      (user) => ids.includes(user.id) || logins.includes(user.login),
    )
    const users =
      ids.length + logins.length === 0 ? [requireUser(state, c.get("token").userId)] : requested
    return c.json({ data: users.map(userJson) })
  })

  app.get("/channels/vips", (c) => listRole(c, state, "vip"))
  app.get("/moderation/moderators", (c) => listRole(c, state, "moderator"))

  return app
}

function listRole(c: Context<HelixEnv>, state: FakeState, role: Role) {
  const { scope, failure: endpoint } = ROLE_ENDPOINTS[role]
  const failure = scriptedHelixFailure(c, state, endpoint)
  if (failure) return failure
  const missingScope = requireScope(c, scope)
  if (missingScope) return missingScope

  const broadcasterId = c.req.query("broadcaster_id")
  if (broadcasterId === undefined)
    return helixError(c, 400, "Missing required parameter broadcaster_id")
  if (broadcasterId !== c.get("token").userId) {
    return helixError(
      c,
      401,
      "The ID in broadcaster_id must match the user ID found in the request's OAuth token",
    )
  }

  const firstParam = c.req.query("first")
  const first = firstParam === undefined ? DEFAULT_PAGE_SIZE : Number(firstParam)
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    return helixError(c, 400, `The first query parameter must be between 1 and ${MAX_PAGE_SIZE}`)
  }
  const afterParam = c.req.query("after")
  const offset = afterParam === undefined ? 0 : Number(afterParam)
  if (!Number.isInteger(offset) || offset < 0)
    return helixError(c, 400, "The after cursor is not valid")

  const holders = [...(state.roles[role].get(broadcasterId) ?? [])]
  const page = holders.slice(offset, offset + first).map((userId) => requireUser(state, userId))
  const next = offset + first
  return c.json({
    data: page.map((user) => ({
      user_id: user.id,
      user_name: user.displayName,
      user_login: user.login,
    })),
    pagination: next < holders.length ? { cursor: String(next) } : {},
  })
}

function userJson(user: FakeUser) {
  return {
    id: user.id,
    login: user.login,
    display_name: user.displayName,
    type: "",
    broadcaster_type: "",
    description: "",
    profile_image_url: "",
    offline_image_url: "",
    created_at: user.createdAt,
  }
}
