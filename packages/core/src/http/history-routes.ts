import { Hono } from "hono"
import type { PublicHistory } from "../accounts/account-store.ts"
import { historyPath } from "../lib/page-paths.ts"
import { isPlatform, providerFor, type Platform } from "../platform/provider.ts"
import type { AppDeps } from "./deps.ts"
import type { PublicHistoryJson } from "./json.ts"
import { readPublicCache, writePublicCache } from "./public-cache.ts"

/** The public history page of a streamer who turned it on. */
export function historyRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // One request per page view. An answer from the cache reads neither the account store nor a room; a
  // miss reads each listed giveaway's counts from its room, so PUBLIC_HISTORY_MAX bounds its subrequests.
  // A streamer without the page is not cached, so turning it on shows at once.
  app.get("/api/s/:platform/:login", async (c) => {
    c.header("Cache-Control", "no-store")
    const platform = c.req.param("platform")
    if (!isPlatform(platform)) return c.json({ error: "not-found" }, 404)
    const login = providerFor(deps.platforms, platform).parseLogin(c.req.param("login"))
    if (login === null) return c.json({ error: "not-found" }, 404)
    const ttlSeconds = deps.config.publicHistoryCacheSeconds
    const key = `${deps.config.publicUrl}/api${historyPath(platform, login)}`
    const cached = await readPublicCache(deps, key, ttlSeconds)
    if (cached !== null) return c.body(cached, 200, { "Content-Type": "application/json" })
    const history = await deps.accounts.findPublicHistory(
      platform,
      login,
      deps.config.publicHistoryMax,
    )
    if (history === null) return c.json({ error: "not-found" }, 404)
    const text = JSON.stringify(await historyJson(deps, platform, history))
    await writePublicCache(deps, key, text, ttlSeconds)
    return c.body(text, 200, { "Content-Type": "application/json" })
  })

  return app
}

async function historyJson(
  deps: AppDeps,
  platform: Platform,
  history: PublicHistory,
): Promise<PublicHistoryJson> {
  return {
    streamer: { platform, ...history.streamer },
    giveaways: await Promise.all(
      history.giveaways.map(async ({ id, ...giveaway }) => {
        const verification = await deps.rooms.get(id).verification()
        return {
          ...giveaway,
          entrantCount: verification.entrantCount,
          winners: verification.picks.filter((pick) => !pick.rerolled).length,
        }
      }),
    ),
  }
}
