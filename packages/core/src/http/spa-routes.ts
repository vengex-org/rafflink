import { Hono } from "hono"
import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import { codeAlphabet, codeLength } from "../lib/codes.ts"
import { errorClass } from "../lib/error-class.ts"
import type { Clock, RateLimiter } from "../ports.ts"
import { parseReferral } from "../stats/referral.ts"
import type { StatsStore } from "../stats/stats-store.ts"
import { drawPath, giveawayPath, verifyPath } from "../lib/page-paths.ts"
import { inlineScriptHashes, renderSpaHtml, type PageMeta } from "../lib/spa-html.ts"
import { isApiPath } from "./api-paths.ts"
import { contentSecurityPolicy } from "./security-headers.ts"
import { indexablePaths, noindex } from "./static-headers.ts"

/** The built `index.html`, or null when no web app is deployed next to this server. */
export type SpaTemplateLoader = () => Promise<string | null>

export interface SpaDeps {
  readonly config: Pick<ResolvedConfig, "publicUrl">
  readonly accounts: Pick<AccountStore, "findGiveawayByCode">
  readonly clock: Clock
  /** The limiter of viewer sign-ins per address, used under its own key so a count never uses up an entry. */
  readonly entryIpLimiter: RateLimiter
  readonly clientAddress: (request: Request) => string | null
  readonly stats: Pick<StatsStore, "countReferral">
}

// The preview of a shared list draw; the list itself is in the fragment, which never reaches the server.
// Only the Bun server applies it: Cloudflare serves `/draw` from the static assets without the Worker.
const drawText = {
  title: "Draw from a list",
  description:
    "Paste names and a public drand round picks the winners. Anyone can check the draw in the browser. No sign-in.",
}

const giveawayRoute = new RegExp(`^/(?:g/)?([${codeAlphabet}]{${codeLength}})(/verify)?$`)

/**
 * The page of every path that is not an API path: the built `index.html` with the link preview of its
 * giveaway, and a CSP that allows its inline scripts by hash. Everything but the {@link indexablePaths} is `noindex`.
 */
export function spaRoutes(deps: SpaDeps, loadTemplate: SpaTemplateLoader): Hono {
  const { publicUrl } = deps.config
  const app = new Hono()

  app.get("*", async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (isApiPath(pathname)) return next()
    const template = await loadTemplate()
    if (template === null) return next()

    if (pathname === "/") await countReferral(deps, c.req.raw)

    const route = giveawayRoute.exec(pathname)
    const code = route?.[1]
    const canonicalPath = (giveawayCode: string) =>
      route?.[2] === undefined ? giveawayPath(giveawayCode) : verifyPath(giveawayCode)
    const giveaway = code === undefined ? null : await deps.accounts.findGiveawayByCode(code)
    const image = `${publicUrl}/og.png`
    const meta: PageMeta =
      giveaway === null
        ? { url: `${publicUrl}${pathname}`, image, text: pathname === drawPath ? drawText : null }
        : {
            url: `${publicUrl}${canonicalPath(giveaway.code)}`,
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
      ...(indexablePaths.includes(pathname) ? {} : { "X-Robots-Tag": noindex }),
    })
  })

  return app
}

// The visit is counted by its label only: no cookie, no redirect, and the address goes to the limiter, not to our storage.
// Over the limit, or without an address, or when the count fails, the page loads and nothing is counted.
async function countReferral(deps: SpaDeps, request: Request): Promise<void> {
  const ref = parseReferral(new URL(request.url).searchParams.get("ref"))
  if (ref === null) return
  try {
    const address = deps.clientAddress(request)
    if (address === null) return skippedReferral("no-address")
    if (!(await deps.entryIpLimiter.allow(`ref:${address}`))) return skippedReferral("rate-limited")
    if ((await deps.stats.countReferral(ref, deps.clock.now())) === "skipped") {
      skippedReferral("day-limit")
    }
  } catch (error) {
    console.warn("referral count failed", { errorClass: errorClass(error) })
  }
}

// Expected under load or a flood, so info; the reason only, never the address.
function skippedReferral(reason: "no-address" | "rate-limited" | "day-limit"): void {
  console.info("referral visit not counted", { reason })
}
