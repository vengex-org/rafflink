/** `X-Robots-Tag` of every page and file except the home page. */
export const noindex = "noindex, nofollow"

const immutable = "public, max-age=31536000, immutable"
const revalidate = "no-cache"

/** The bundles `bun build` names with a content hash and the versioned font files; every other file keeps its name across builds. */
const hashedAsset = /^\/(?:index-[a-z0-9]+\.(?:js|css)|fonts\/[^/]+)$/
const hashedAssetGlobs = ["/index-*.js", "/index-*.css", "/fonts/*"] as const

export function staticCacheControl(pathname: string): string {
  return hashedAsset.test(pathname) ? immutable : revalidate
}

/**
 * The `_headers` file of Cloudflare static assets, which are answered without the Worker: the security
 * headers, the cache rules of {@link staticCacheControl} and {@link noindex} for every path but the home page.
 */
export function headersFile(security: Readonly<Record<string, string>>): string {
  const everything = [...Object.entries(security), ["Cache-Control", revalidate]]
  const hashed = hashedAssetGlobs.map((glob) =>
    [glob, "  ! Cache-Control", `  Cache-Control: ${immutable}`].join("\n"),
  )
  return [
    ["/*", ...everything.map(([name, value]) => `  ${name}: ${value}`)].join("\n"),
    // Cloudflare does not apply a `! X-Robots-Tag` detach under `/` to the home page, so noindex goes on each
    // page below it instead: `/:segment` never matches `/`, the splats cover the deeper app routes.
    ...["/:segment", "/g/*", "/live/*", "/overlay/*"].map(
      (pattern) => `${pattern}\n  X-Robots-Tag: ${noindex}`,
    ),
    ...hashed,
    "",
  ].join("\n")
}
