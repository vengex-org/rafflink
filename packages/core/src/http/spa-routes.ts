import { Hono } from "hono"
import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import { codeAlphabet, codeLength } from "../lib/codes.ts"
import { inlineScriptHashes, renderSpaHtml, type PageMeta } from "../lib/spa-html.ts"
import { isApiPath } from "./api-paths.ts"
import { contentSecurityPolicy } from "./security-headers.ts"
import { noindex } from "./static-headers.ts"

/** The built `index.html`, or null when no web app is deployed next to this server. */
export type SpaTemplateLoader = () => Promise<string | null>

export interface SpaDeps {
  readonly config: Pick<ResolvedConfig, "publicUrl">
  readonly accounts: Pick<AccountStore, "findGiveawayByCode">
}

const giveawayPath = new RegExp(`^/(?:g/)?([${codeAlphabet}]{${codeLength}})$`)

/**
 * The page of every path that is not an API path: the built `index.html` with the link preview of its
 * giveaway, and a CSP that allows its inline scripts by hash. Everything but the home page is `noindex`.
 */
export function spaRoutes(deps: SpaDeps, loadTemplate: SpaTemplateLoader): Hono {
  const { publicUrl } = deps.config
  const app = new Hono()

  app.get("*", async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (isApiPath(pathname)) return next()
    const template = await loadTemplate()
    if (template === null) return next()

    const code = giveawayPath.exec(pathname)?.[1]
    const giveaway = code === undefined ? null : await deps.accounts.findGiveawayByCode(code)
    const image = `${publicUrl}/icon-512.png`
    const meta: PageMeta =
      giveaway === null
        ? { url: `${publicUrl}${pathname}`, image, text: null }
        : {
            url: `${publicUrl}/${giveaway.code}`,
            image,
            text: {
              title: giveaway.title ?? `Giveaway ${giveaway.code}`,
              description:
                giveaway.prize === null
                  ? `Enter the giveaway of ${giveaway.streamerName}. Sign in with Twitch to join.`
                  : `Win ${giveaway.prize} from ${giveaway.streamerName}. Sign in with Twitch to join.`,
            },
          }
    const scriptHashes = await inlineScriptHashes(template)
    return c.html(renderSpaHtml(template, meta), 200, {
      "Content-Security-Policy": contentSecurityPolicy(scriptHashes),
      "Cache-Control": "no-cache",
      ...(pathname === "/" ? {} : { "X-Robots-Tag": noindex }),
    })
  })

  return app
}
