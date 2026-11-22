import type { MiddlewareHandler } from "hono"
import type { ResolvedConfig } from "../config.ts"

export type OriginConfig = Pick<ResolvedConfig, "publicUrl">

/** Refuses a request whose `Origin` is another site's; a request without `Origin` is not a browser page and passes. */
export function sameOrigin(config: OriginConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!originAllowed(config, c.req.header("origin"), true)) {
      return c.json({ error: "forbidden-origin" }, 403)
    }
    return next()
  }
}

export function originAllowed(
  config: OriginConfig,
  origin: string | undefined,
  allowMissing: boolean,
): boolean {
  return origin === undefined ? allowMissing : origin === config.publicUrl
}

/**
 * CSRF guard of a state-changing admin call: the request must come from a page of this origin, so a missing
 * `Origin` is refused too, and carry a JSON body, which a cross-site form cannot send without a CORS preflight.
 */
export function sameOriginJson(config: OriginConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!originAllowed(config, c.req.header("origin"), false)) {
      return c.json({ error: "forbidden-origin" }, 403)
    }
    const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase()
    if (type !== "application/json") return c.json({ error: "unsupported-media-type" }, 415)
    return next()
  }
}
