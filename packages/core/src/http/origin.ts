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
