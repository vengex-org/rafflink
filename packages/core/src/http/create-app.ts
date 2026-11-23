import { errorClass } from "../lib/error-class.ts"
import { PlatformOff } from "../platform/provider.ts"
import { Hono } from "hono"
import { requestId } from "hono/request-id"
import { authRoutes, type Backlog } from "./auth-routes.ts"
import { dashboardRoutes } from "./dashboard-routes.ts"
import type { AppDeps } from "./deps.ts"
import { giveawayRoutes } from "./giveaway-routes.ts"
import { historyRoutes } from "./history-routes.ts"
import { moderatorRoutes } from "./moderator-routes.ts"
import { presenceRoutes } from "./presence-routes.ts"
import { sessionRoutes } from "./session-routes.ts"
import { securityHeadersMiddleware } from "./security-headers.ts"
import { spaRoutes, type WebFileLoader } from "./spa-routes.ts"
import { webhookRoutes } from "./webhook-routes.ts"

export type { AppDeps } from "./deps.ts"
export type { WebFileLoader } from "./spa-routes.ts"

/** `webFiles` loads the files of the web build the pages are answered with; null serves the API only. */
export function createApp(deps: AppDeps, webFiles: WebFileLoader | null): Hono {
  const backlog: Backlog = { until: 0 }
  const app = new Hono()

  app.use(requestId())
  app.use(securityHeadersMiddleware(deps.config))
  app.route("/", authRoutes(deps, backlog))
  app.route("/", giveawayRoutes(deps))
  app.route("/", historyRoutes(deps))
  app.route("/", sessionRoutes(deps))
  app.route("/", dashboardRoutes(deps))
  app.route("/", moderatorRoutes(deps))
  app.route("/", presenceRoutes(deps))
  app.route("/", webhookRoutes(deps))
  if (webFiles !== null) app.route("/", spaRoutes(deps, webFiles))

  app.notFound((c) => c.json({ error: "not-found" }, 404))
  // The log keeps only the error class and the request id: a message or a stack can carry a token, a code or a name.
  // The report to Sentry carries both, after `scrubEvent` of lib/error-reporting.ts removed the secrets it knows.
  app.onError((error, c) => {
    // Rows of a platform switched off after they were made are expected, so the refusal is no fault to report.
    if (error instanceof PlatformOff) return c.json({ error: "platform-off" }, 409)
    const id = c.get("requestId")
    deps.reportError(error, { requestId: id })
    console.error("request failed", {
      requestId: id,
      errorClass: errorClass(error),
    })
    return c.json({ error: "internal", requestId: id }, 500)
  })

  return app
}
