import { Hono } from "hono"
import { codeAlphabet, codeLength } from "../lib/codes.ts"
import { errorClass } from "../lib/error-class.ts"
import { isPlatform } from "../platform/provider.ts"
import { parseReferral } from "../stats/referral.ts"
import {
  drawPath,
  giveawayPath,
  historyDataElementId,
  historyPath,
  localizedPath,
  pageOfPath,
  parsePrerenderManifest,
  prerenderManifestFile,
  verifyPath,
} from "../lib/page-paths.ts"
import {
  embedJson,
  errorReportOrigin,
  inlineScriptHashes,
  renderSpaHtml,
  withoutRobotsMeta,
  type PageMeta,
} from "../lib/spa-html.ts"
import { isApiPath } from "./api-paths.ts"
import type { AppDeps } from "./deps.ts"
import { publicHistoryAnswer, type PublicHistoryAnswer } from "./history-routes.ts"
import { contentSecurityPolicy } from "./security-headers.ts"

/**
 * A file of the web build by its path relative to the build's root, such as `index.html`, the app shell; null when
 * no web app is deployed next to this server.
 */
export type WebFileLoader = (file: string) => Promise<string | null>

/** `X-Robots-Tag` of the pages search engines must not index, beside the robots meta of the app shell. */
export const noindex = "noindex, nofollow"

// The preview of a shared list draw; the list itself is in the fragment, which never reaches the server.
// Only the Bun server applies it: Cloudflare serves `/draw` from the static assets without the Worker.
const drawText = {
  title: "Draw from a list",
  description:
    "Paste names and a public drand round picks the winners. Anyone can check the draw in the browser. No sign-in.",
}

const giveawayRoute = new RegExp(`^/(?:g/)?([${codeAlphabet}]{${codeLength}})(/verify)?$`)

/**
 * The page of every path that is not an API path, with a CSP that allows its inline scripts by hash: the file the
 * web build prerendered for it, else the app shell with the link preview of its giveaway or public history.
 * Everything but the localized pages and the history pages whose streamer allows it is `noindex`.
 */
export function spaRoutes(deps: AppDeps, loadFile: WebFileLoader): Hono {
  const { publicUrl } = deps.config
  const app = new Hono()

  // The page carries the answer of `/api/s/...`, so a view costs one Worker request. A login a renamed streamer
  // gave up redirects to their page, so links in channel panels keep working.
  app.get("/s/:platform/:login", async (c, next) => {
    const template = await loadFile(shellFile)
    if (template === null) return next()
    const platform = c.req.param("platform")
    const provider = isPlatform(platform) ? deps.platforms[platform] : undefined
    const login = provider === undefined ? null : provider.parseLogin(c.req.param("login"))
    const answer: PublicHistoryAnswer =
      provider === undefined || login === null
        ? { kind: "missing" }
        : await publicHistoryAnswer(deps, provider.platform, login)
    const headers = await pageHeaders(template)
    const image = `${publicUrl}/og.png`
    // The page this answer is for, as the app names it from the address bar, in lower case like a parsed login.
    const dataPath = historyPath(platform, c.req.param("login")).toLowerCase()
    switch (answer.kind) {
      case "moved": {
        // Browsers keep a 301 without a cache rule for good, and the old login can pass to another streamer.
        c.header("Cache-Control", "no-cache")
        const location = `${historyPath(platform, answer.login)}${new URL(c.req.url).search}`
        return c.redirect(location, 301)
      }
      case "missing": {
        const meta: PageMeta = { url: `${publicUrl}${c.req.path}`, image, text: null }
        const html = embedJson(
          renderSpaHtml(template, meta),
          historyDataElementId,
          dataPath,
          "null",
        )
        return c.html(html, 404, { ...headers, "X-Robots-Tag": noindex })
      }
      case "found": {
        const { streamer } = answer
        const meta: PageMeta = {
          url: `${publicUrl}${historyPath(streamer.platform, streamer.login)}`,
          image,
          text: {
            title: `Giveaways of ${streamer.displayName}`,
            description: `The finished giveaways of ${streamer.displayName} on Rafflink, each with a check of its draw.`,
          },
        }
        const html = embedJson(
          renderSpaHtml(template, meta),
          historyDataElementId,
          dataPath,
          answer.text,
        )
        return streamer.indexed
          ? c.html(withoutRobotsMeta(html), 200, headers)
          : c.html(html, 200, { ...headers, "X-Robots-Tag": noindex })
      }
    }
  })

  app.get("*", async (c, next) => {
    const { pathname } = new URL(c.req.url)
    if (isApiPath(pathname)) return next()
    const page = await pageOf(loadFile, pathname)
    if (page === null) return next()

    if (pathname === "/") await countReferral(deps, c.req.raw)
    const headers = await pageHeaders(page.html)
    if (page.prerendered) return c.html(page.html, 200, headers)

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
    const html = renderSpaHtml(page.html, meta)
    // A localized page the build did not prerender, as one built without PUBLIC_URL, stays indexable as the shell.
    return pageOfPath(pathname) === null
      ? c.html(html, 200, { ...headers, "X-Robots-Tag": noindex })
      : c.html(withoutRobotsMeta(html), 200, headers)
  })

  return app
}

const shellFile = "index.html"

/** The file the build prerendered for `pathname`, else the app shell; null without a web build. */
async function pageOf(
  loadFile: WebFileLoader,
  pathname: string,
): Promise<{ readonly html: string; readonly prerendered: boolean } | null> {
  const address = pageOfPath(pathname)
  const manifest = await loadFile(prerenderManifestFile)
  const file =
    manifest === null
      ? undefined
      : parsePrerenderManifest(manifest).get(
          address === null ? pathname : localizedPath(address.language, address.page),
        )
  const prerendered = file === undefined ? null : await loadFile(file)
  if (prerendered !== null) return { html: prerendered, prerendered: true }
  const shell = await loadFile(shellFile)
  return shell === null ? null : { html: shell, prerendered: false }
}

async function pageHeaders(html: string): Promise<Record<string, string>> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(
      await inlineScriptHashes(html),
      errorReportOrigin(html),
    ),
    "Cache-Control": "no-cache",
  }
}

// The visit is counted by its label only: no cookie, no redirect, and the address goes to the limiter, not to our storage.
// Over the limit, or without an address, or when the count fails, the page loads and nothing is counted.
async function countReferral(deps: AppDeps, request: Request): Promise<void> {
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
