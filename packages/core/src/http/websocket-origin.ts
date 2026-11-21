import type { MiddlewareHandler } from "hono"
import type { ResolvedConfig } from "../config.ts"

type OriginConfig = Pick<ResolvedConfig, "publicUrl">

export interface WebSocketOriginOptions {
  /** OBS and other non-browser clients send no `Origin`; only a route that is a read-only view of a secret URL admits them. */
  readonly allowMissing: boolean
}

/**
 * Refuses a WebSocket upgrade from a page of another origin: browsers send cookies on a cross-site
 * upgrade, so without this any site could read the streamer's live socket. Plain requests pass.
 */
export function webSocketOrigin(
  config: OriginConfig,
  options: WebSocketOriginOptions,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    if (!originAllowed(config, c.req.header("origin"), options.allowMissing)) {
      return c.json({ error: "forbidden-origin" }, 403)
    }
    return next()
  }
}

/** Refuses a request whose `Origin` is another site's; a request without `Origin` is not a browser page and passes. */
export function sameOrigin(config: OriginConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!originAllowed(config, c.req.header("origin"), true)) {
      return c.json({ error: "forbidden-origin" }, 403)
    }
    return next()
  }
}

function originAllowed(
  config: OriginConfig,
  origin: string | undefined,
  allowMissing: boolean,
): boolean {
  return origin === undefined ? allowMissing : origin === config.publicUrl
}
