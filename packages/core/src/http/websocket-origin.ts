import type { MiddlewareHandler } from "hono"
import type { ResolvedConfig } from "../config.ts"

export interface WebSocketOriginOptions {
  /** OBS and other non-browser clients send no `Origin`; only a route that is a read-only view of a secret URL admits them. */
  readonly allowMissing: boolean
}

/**
 * Refuses a WebSocket upgrade from a page of another origin: browsers send cookies on a cross-site
 * upgrade, so without this any site could read the streamer's live socket. Plain requests pass.
 */
export function webSocketOrigin(
  config: Pick<ResolvedConfig, "publicUrl">,
  options: WebSocketOriginOptions,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const origin = c.req.header("origin")
    const allowed = origin === undefined ? options.allowMissing : origin === config.publicUrl
    if (!allowed) return c.json({ error: "forbidden-origin" }, 403)
    return next()
  }
}
