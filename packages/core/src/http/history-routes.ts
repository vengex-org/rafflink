import { Hono } from "hono"
import type { ResolvedConfig } from "../config.ts"
import { historyPath } from "../lib/page-paths.ts"
import { isPlatform, providerFor } from "../platform/provider.ts"
import type { AppDeps } from "./deps.ts"
import type { PublicHistoryJson } from "./json.ts"
import { readPublicCache, writePublicCache } from "./public-cache.ts"

/** The public history page of a streamer who turned it on. */
export function historyRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // One request per page view. An answer from the cache reads nothing; a miss reads D1 only, since the rooms
  // mirror their counts. A streamer without the page is not cached, so turning it on shows at once.
  app.get("/api/s/:platform/:login", async (c) => {
    c.header("Cache-Control", "no-store")
    const platform = c.req.param("platform")
    if (!isPlatform(platform)) return c.json({ error: "not-found" }, 404)
    const login = providerFor(deps.platforms, platform).parseLogin(c.req.param("login"))
    if (login === null) return c.json({ error: "not-found" }, 404)
    const ttlSeconds = deps.config.publicHistoryCacheSeconds
    const key = historyCacheKey(deps.config, platform, login)
    const cached = await readPublicCache(deps, key, ttlSeconds)
    if (cached !== null) return c.body(cached, 200, { "Content-Type": "application/json" })
    const history = await deps.accounts.findPublicHistory(platform, login, {
      limit: deps.config.publicHistoryMax,
      approvedOnly: !deps.config.openSignup,
    })
    if (history === null) return c.json({ error: "not-found" }, 404)
    const body: PublicHistoryJson = {
      streamer: { platform, ...history.streamer },
      giveaways: history.giveaways,
    }
    const text = JSON.stringify(body)
    await writePublicCache(deps, key, text, ttlSeconds)
    return c.body(text, 200, { "Content-Type": "application/json" })
  })

  return app
}

/** The public cache key of a streamer's history answer; the login is the platform's, as `parseLogin` gives it. */
export function historyCacheKey(
  config: Pick<ResolvedConfig, "publicUrl">,
  platform: string,
  login: string,
): string {
  return `${config.publicUrl}/api${historyPath(platform, login)}`
}
