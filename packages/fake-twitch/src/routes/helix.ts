import { Hono, type Context } from "hono"
import { helixAuth, requireScope, type HelixEnv } from "../lib/auth.ts"
import { helixError, scriptedHelixFailure } from "../lib/responses.ts"
import {
  pairKey,
  requireUser,
  type FakeState,
  type FakeUser,
  type Role,
  type Tier,
} from "../state.ts"

/** Twitch caps `first` on paginated endpoints at 100. */
const maxPageSize = 100
const defaultPageSize = 20

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
    const logins = (c.req.queries("login") ?? []).map((login) => login.toLowerCase())
    if (ids.length + logins.length > maxPageSize) {
      return helixError(
        c,
        400,
        `The combined number of id and login parameters may not exceed ${maxPageSize}`,
      )
    }
    const { userId } = c.get("token")
    if (ids.length + logins.length === 0) {
      return userId === null
        ? helixError(c, 400, "Missing required parameter id or login")
        : c.json({ data: [userJson(requireUser(state, userId))] })
    }
    const requested = [...state.users.values()].filter(
      (user) => ids.includes(user.id) || logins.includes(user.login.toLowerCase()),
    )
    return c.json({ data: requested.map(userJson) })
  })

  app.get("/chat/badges", (c) => {
    const failure = scriptedHelixFailure(c, state, "badges")
    if (failure) return failure
    const broadcasterId = c.req.query("broadcaster_id")
    if (broadcasterId === undefined) {
      return helixError(c, 400, "Missing required parameter broadcaster_id")
    }
    const images = state.channelSubscriberBadges.get(broadcasterId)
    return c.json({
      data:
        images === undefined ? [] : [{ set_id: "subscriber", versions: tierBadgeVersions(images) }],
    })
  })

  app.get("/chat/badges/global", (c) => {
    const failure = scriptedHelixFailure(c, state, "badges")
    if (failure) return failure
    return c.json({
      data: [{ set_id: "subscriber", versions: [badgeVersion("0", globalSubscriberBadgeUrl)] }],
    })
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
  const first = firstParam === undefined ? defaultPageSize : Number(firstParam)
  if (!Number.isInteger(first) || first < 1 || first > maxPageSize) {
    return helixError(c, 400, `The first query parameter must be between 1 and ${maxPageSize}`)
  }
  const afterParam = c.req.query("after")
  const offset = afterParam === undefined ? 0 : Number(afterParam)
  if (!Number.isInteger(offset) || offset < 0)
    return helixError(c, 400, "The after cursor is not valid")

  // Twitch's `user_id` filter answers only the listed users that hold the role.
  const userIds = c.req.queries("user_id") ?? null
  const holders = [...(state.roles[role].get(broadcasterId) ?? [])].filter(
    (userId) => userIds === null || userIds.includes(userId),
  )
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

/** The global subscriber badge image; the fake serves one for every channel without its own. */
export const globalSubscriberBadgeUrl =
  "https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/1"

// Twitch names a channel's badge versions by months subscribed, and the first of a tier by the tier: "0" for tier 1, "2000" and "3000" for the others.
const tiers: readonly Tier[] = ["1000", "2000", "3000"]
const tierVersionIds: Readonly<Record<Tier, string>> = {
  "1000": "0",
  "2000": "2000",
  "3000": "3000",
}

function tierBadgeVersions(images: Partial<Record<Tier, string>>) {
  return tiers.flatMap((tier) => {
    const image = images[tier]
    return image === undefined ? [] : [badgeVersion(tierVersionIds[tier], image)]
  })
}

function badgeVersion(id: string, image: string) {
  return {
    id,
    image_url_1x: image,
    image_url_2x: image,
    image_url_4x: image,
    title: "Subscriber",
    description: "Subscriber",
    click_action: "subscribe_to_channel",
    click_url: "",
  }
}

function userJson(user: FakeUser) {
  return {
    id: user.id,
    login: user.login,
    display_name: user.displayName,
    type: "",
    broadcaster_type: "",
    description: "",
    profile_image_url: user.profileImageUrl,
    offline_image_url: "",
    created_at: user.createdAt,
  }
}
