const immutable = "public, max-age=31536000, immutable"
const revalidate = "no-cache"

/** The bundles `bun build` names with a content hash; every other file keeps its name across builds. */
const hashedAsset = /^\/index-[a-z0-9]+\.(?:js|css)$/
const hashedAssetGlobs = ["/index-*.js", "/index-*.css"] as const

export function staticCacheControl(pathname: string): string {
  return hashedAsset.test(pathname) ? immutable : revalidate
}

/**
 * The `_headers` file of Cloudflare static assets, which are answered without the Worker: the security
 * headers and the cache rules of {@link staticCacheControl} for every file.
 */
export function headersFile(security: Readonly<Record<string, string>>): string {
  const everything = [...Object.entries(security), ["Cache-Control", revalidate]]
  const hashed = hashedAssetGlobs.map((glob) =>
    [glob, "  ! Cache-Control", `  Cache-Control: ${immutable}`].join("\n"),
  )
  return [
    ["/*", ...everything.map(([name, value]) => `  ${name}: ${value}`)].join("\n"),
    ...hashed,
    "",
  ].join("\n")
}
