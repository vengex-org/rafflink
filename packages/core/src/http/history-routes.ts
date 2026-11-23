import { Hono } from "hono"
import type { ResolvedConfig } from "../config.ts"
import { historyPath } from "../lib/page-paths.ts"
import { isPlatform, type Platform } from "../platform/provider.ts"
import type { AppDeps } from "./deps.ts"
import { objectField, type PublicHistoryJson } from "./json.ts"
import { readPublicCache, writePublicCache } from "./public-cache.ts"

/** The public history page of a streamer who turned it on. */
export function historyRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // The page itself carries this answer (see spa-routes.ts), so the app asks for it only after navigating in the browser.
  app.get("/api/s/:platform/:login", async (c) => {
    c.header("Cache-Control", "no-store")
    const platform = c.req.param("platform")
    const provider = isPlatform(platform) ? deps.platforms[platform] : undefined
    if (provider === undefined) return c.json({ error: "not-found" }, 404)
    const login = provider.parseLogin(c.req.param("login"))
    if (login === null) return c.json({ error: "not-found" }, 404)
    const answer = await publicHistoryAnswer(deps, provider.platform, login)
    switch (answer.kind) {
      case "found":
        return c.body(answer.text, 200, { "Content-Type": "application/json" })
      case "moved":
        return c.redirect(`/api${historyPath(provider.platform, answer.login)}`, 308)
      case "missing":
        return c.json({ error: "not-found" }, 404)
    }
  })

  return app
}

/** A login's public history: the JSON the API answers with its streamer, the login a renamed streamer has now, or nothing. */
export type PublicHistoryAnswer =
  | {
      readonly kind: "found"
      readonly text: string
      readonly streamer: PublicHistoryJson["streamer"]
    }
  | { readonly kind: "moved"; readonly login: string }
  | { readonly kind: "missing" }

/**
 * One cache read per view. A miss reads D1 only, since the rooms mirror their counts. A streamer without the
 * page and an old login are not cached, so turning the page on shows at once and a rename redirects at once.
 */
export async function publicHistoryAnswer(
  deps: AppDeps,
  platform: Platform,
  login: string,
): Promise<PublicHistoryAnswer> {
  const ttlSeconds = deps.config.publicHistoryCacheSeconds
  const key = historyCacheKey(deps.config, platform, login)
  const cached = await readPublicCache(deps, key, ttlSeconds)
  if (cached !== null) return { kind: "found", text: cached, streamer: streamerOf(cached) }
  const lookup = await deps.accounts.findPublicHistory(platform, login, {
    limit: deps.config.publicHistoryMax,
    approvedOnly: !deps.config.openSignup,
  })
  if (lookup.kind !== "found") return lookup
  const { history } = lookup
  const body: PublicHistoryJson = {
    streamer: {
      platform,
      login: history.streamer.login,
      displayName: history.streamer.displayName,
      indexed: history.streamer.historyIndexed,
    },
    giveaways: history.giveaways,
  }
  const text = JSON.stringify(body)
  await writePublicCache(deps, key, text, ttlSeconds)
  return { kind: "found", text, streamer: body.streamer }
}

/** The public cache key of a streamer's history answer; the login is the platform's, as `parseLogin` gives it. */
export function historyCacheKey(
  config: Pick<ResolvedConfig, "publicUrl">,
  platform: string,
  login: string,
): string {
  return `${config.publicUrl}/api${historyPath(platform, login)}`
}

// The streamer of a cached answer, which publicHistoryAnswer wrote; a copy of another shape is a bug, not a miss.
function streamerOf(text: string): PublicHistoryJson["streamer"] {
  const streamer = objectField(JSON.parse(text), "streamer")
  const platform = objectField(streamer, "platform")
  const login = objectField(streamer, "login")
  const displayName = objectField(streamer, "displayName")
  const indexed = objectField(streamer, "indexed")
  if (
    typeof platform !== "string"
    || !isPlatform(platform)
    || typeof login !== "string"
    || typeof displayName !== "string"
    || typeof indexed !== "boolean"
  ) {
    throw new TypeError("a cached public history has no streamer")
  }
  return { platform, login, displayName, indexed }
}
