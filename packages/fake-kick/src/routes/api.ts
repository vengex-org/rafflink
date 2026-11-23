import type { Context } from "hono"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { takeFailure, type AccessToken, type FailableEndpoint, type FakeState } from "../state.ts"

type ApiEnv = { Variables: { token: AccessToken } }

/** `api.kick.com/public/v1`: users, channels, the webhook public key and event subscriptions. */
export function apiRoutes(state: FakeState): Hono {
  const app = new Hono()
  const auth = bearerAuth(state)

  app.get("/public-key", async (c) => {
    const failed = scriptedFailure(c, state, "public-key")
    if (failed !== undefined) return failed
    return c.json({ data: { public_key: (await state.signingKey).publicPem }, message: "OK" })
  })

  app.get("/users", auth, (c) => {
    const failed = scriptedFailure(c, state, "users")
    if (failed !== undefined) return failed
    const token = c.get("token")
    const ids = c.req.queries("id") ?? []
    if (ids.length === 0) {
      if (token.userId === null || !token.scopes.includes("user:read")) {
        return c.json({ message: "Unauthorized" }, 401)
      }
      return c.json({ data: userJson(state, token.userId), message: "OK" })
    }
    return c.json({ data: ids.flatMap((id) => userJson(state, id)), message: "OK" })
  })

  app.get("/channels", auth, (c) => {
    const slugs = c.req.queries("slug") ?? []
    const channels = [...state.users.values()]
      .filter((user) => slugs.includes(user.name.toLowerCase()))
      .map((user) => ({ broadcaster_user_id: Number(user.id), slug: user.name.toLowerCase() }))
    return c.json({ data: channels, message: "OK" })
  })

  app.post("/events/subscriptions", auth, async (c) => {
    const failed = scriptedFailure(c, state, "subscribe")
    if (failed !== undefined) return failed
    const token = c.get("token")
    const body: unknown = await c.req.json()
    if (!isRecord(body) || body.method !== "webhook" || !Array.isArray(body.events)) {
      return c.json({ message: "Bad Request" }, 400)
    }
    if (token.userId !== null && !token.scopes.includes("events:subscribe")) {
      return c.json({ message: "Forbidden" }, 403)
    }
    // A user token subscribes its own channel; Kick ignores the body's broadcaster then.
    const broadcasterId = token.userId ?? String(body.broadcaster_user_id)
    const data = body.events.flatMap((event: unknown) => {
      if (!isRecord(event) || typeof event.name !== "string" || typeof event.version !== "number") {
        return []
      }
      const id = crypto.randomUUID()
      state.subscriptions.set(id, {
        id,
        broadcasterId,
        event: event.name,
        version: event.version,
      })
      return [{ name: event.name, version: event.version, subscription_id: id, error: null }]
    })
    return c.json({ data, message: "OK" })
  })

  app.get("/events/subscriptions", auth, (c) => {
    const data = [...state.subscriptions.values()].map((subscription) => ({
      id: subscription.id,
      broadcaster_user_id: Number(subscription.broadcasterId),
      event: subscription.event,
      version: subscription.version,
      method: "webhook",
    }))
    return c.json({ data, message: "OK" })
  })

  app.delete("/events/subscriptions", auth, (c) => {
    const failed = scriptedFailure(c, state, "unsubscribe")
    if (failed !== undefined) return failed
    for (const id of c.req.queries("id") ?? []) state.subscriptions.delete(id)
    return c.body(null, 204)
  })

  return app
}

function bearerAuth(state: FakeState) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const accessToken = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1]
    const token = accessToken === undefined ? undefined : state.accessTokens.get(accessToken)
    if (token === undefined || token.revoked) return c.json({ message: "Unauthorized" }, 401)
    c.set("token", token)
    await next()
  })
}

function userJson(state: FakeState, id: string) {
  const user = state.users.get(id)
  if (user === undefined) return []
  return [
    {
      user_id: Number(user.id),
      name: user.name,
      email: `${user.name.toLowerCase()}@example.com`,
      profile_picture: "",
    },
  ]
}

function scriptedFailure(c: Context, state: FakeState, endpoint: FailableEndpoint) {
  const status = takeFailure(state, endpoint)
  return status === undefined ? undefined : c.json({ message: "scripted failure" }, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
