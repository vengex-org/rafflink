import { Hono } from "hono"
import {
  parsePresenceKind,
  presenceKindHeader,
  presenceSocketPath,
} from "../presence/site-presence.ts"
import type { AppDeps } from "./deps.ts"
import { webSocketOrigin } from "./websocket-origin.ts"

export function presenceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.use(presenceSocketPath, webSocketOrigin(deps.config, { allowMissing: false }))

  // Only decides whether the socket may connect and names its kind; the target's socket layer counts it.
  // The address is only a rate limit key and is not kept. The answer to the upgrade request never reaches a browser.
  app.get(presenceSocketPath, async (c) => {
    if (deps.presence === null) return c.json({ error: "not-found" }, 404)
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "upgrade-required" }, 426)
    }
    const kind = parsePresenceKind(c.req.query("kind"))
    if (kind === null) return c.json({ error: "invalid-input", field: "kind" }, 400)
    const address = deps.clientAddress(c.req.raw)
    if (address !== null && !(await deps.presenceIpLimiter.allow(address))) {
      return c.json({ error: "rate-limited" }, 429)
    }
    c.header(presenceKindHeader, kind)
    return c.body(null, 204)
  })

  return app
}
