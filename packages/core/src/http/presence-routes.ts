import { Hono } from "hono"
import { parsePresenceKind, presenceSocketPath } from "../presence/site-presence.ts"
import type { AppDeps } from "./deps.ts"
import { webSocketOrigin } from "./websocket-origin.ts"

export function presenceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.use(presenceSocketPath, webSocketOrigin(deps.config, { allowMissing: false }))

  // Only decides whether the socket may connect; the target's socket layer counts it. Nothing about the
  // visitor is read or kept. The answer to the upgrade request never reaches a browser.
  app.get(presenceSocketPath, (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "upgrade-required" }, 426)
    }
    if (parsePresenceKind(c.req.query("kind")) === null) {
      return c.json({ error: "invalid-input", field: "kind" }, 400)
    }
    return c.body(null, 204)
  })

  return app
}
