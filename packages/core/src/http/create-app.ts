import { Hono } from "hono"
import { requestId } from "hono/request-id"
import { authRoutes, type Cooldown } from "./auth-routes.ts"
import { dashboardRoutes } from "./dashboard-routes.ts"
import type { AppDeps } from "./deps.ts"
import { giveawayRoutes } from "./giveaway-routes.ts"

export type { AppDeps } from "./deps.ts"

export function createApp(deps: AppDeps): Hono {
  const cooldown: Cooldown = { until: 0 }
  const app = new Hono()

  app.use(requestId())
  app.route("/", authRoutes(deps, cooldown))
  app.route("/", giveawayRoutes(deps))
  app.route("/", dashboardRoutes(deps))

  app.notFound((c) => c.json({ error: "not-found" }, 404))
  // Only the error class and the request id: a message or a stack can carry a token, a code or a name.
  app.onError((error, c) => {
    const id = c.get("requestId")
    console.error("request failed", {
      requestId: id,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
    })
    return c.json({ error: "internal", requestId: id }, 500)
  })

  return app
}
