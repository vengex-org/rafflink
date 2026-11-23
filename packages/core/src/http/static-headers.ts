import { prerenderManifestFile } from "../lib/page-paths.ts"

/** `X-Robots-Tag` of the pages and files search engines must not index, beside the robots meta of the app shell. */
export const noindex = "noindex, nofollow"

/**
 * The public history pages, which the Worker answers too: the streamer decides whether one is indexed, and the
 * login a renamed streamer gave up redirects. No static asset answers these paths on Cloudflare.
 */
export const historyPagePattern = "/s/*"

const immutable = "public, max-age=31536000, immutable"
const revalidate = "no-cache"

/** The bundles `bun build` names with a content hash and the versioned font files; every other file keeps its name across builds. */
const hashedAsset = /^\/(?:index-[a-z0-9]+\.(?:js|css)|fonts\/[^/]+)$/
const hashedAssetGlobs = ["/index-*.js", "/index-*.css", "/fonts/*"] as const

export function staticCacheControl(pathname: string): string {
  return hashedAsset.test(pathname) ? immutable : revalidate
}

/** The prerender manifest is for the servers, not for search results; every other file has no robots header. */
const unindexedFile = `/${prerenderManifestFile}`

/** The `X-Robots-Tag` of a static file, null for one search engines may list. */
export function staticRobotsTag(pathname: string): string | null {
  return pathname === unindexedFile ? noindex : null
}

/**
 * The `_headers` file of Cloudflare static assets, which are answered without the Worker: the security
 * headers and the cache rules of {@link staticCacheControl}. Pages that must not be indexed say so in the app
 * shell's robots meta, which the prerendered pages leave out.
 */
export function headersFile(security: Readonly<Record<string, string>>): string {
  const everything = [...Object.entries(security), ["Cache-Control", revalidate]]
  const hashed = hashedAssetGlobs.map((glob) =>
    [glob, "  ! Cache-Control", `  Cache-Control: ${immutable}`].join("\n"),
  )
  return [
    ["/*", ...everything.map(([name, value]) => `  ${name}: ${value}`)].join("\n"),
    `${unindexedFile}\n  X-Robots-Tag: ${noindex}`,
    ...hashed,
    "",
  ].join("\n")
}
