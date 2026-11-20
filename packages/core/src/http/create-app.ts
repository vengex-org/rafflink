import { errorClass } from "../lib/error-class.ts"
import { Hono } from "hono"
import { requestId } from "hono/request-id"
import { authRoutes, type Cooldown } from "./auth-routes.ts"
import { dashboardRoutes } from "./dashboard-routes.ts"
import type { AppDeps } from "./deps.ts"
import { giveawayRoutes } from "./giveaway-routes.ts"
import { securityHeadersMiddleware } from "./security-headers.ts"
import { spaRoutes, type SpaTemplateLoader } from "./spa-routes.ts"

export type { AppDeps } from "./deps.ts"
export type { SpaTemplateLoader } from "./spa-routes.ts"

/** `spaTemplate` loads the built `index.html` the pages are answered with; null serves the API only. */
export function createApp(deps: AppDeps, spaTemplate: SpaTemplateLoader | null): Hono {
  const cooldown: Cooldown = { until: 0 }
  const app = new Hono()

  app.use(requestId())
  app.use(securityHeadersMiddleware(deps.config))
  app.route("/", authRoutes(deps, cooldown))
  app.route("/", giveawayRoutes(deps))
  app.route("/", dashboardRoutes(deps))
  if (spaTemplate !== null) app.route("/", spaRoutes(deps, spaTemplate))

  app.notFound((c) => c.json({ error: "not-found" }, 404))
  // Only the error class and the request id: a message or a stack can carry a token, a code or a name.
  app.onError((error, c) => {
    const id = c.get("requestId")
    console.error("request failed", {
      requestId: id,
      errorClass: errorClass(error),
    })
    return c.json({ error: "internal", requestId: id }, 500)
  })

  return app
}
