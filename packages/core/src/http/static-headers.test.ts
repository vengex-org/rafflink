import { describe, expect, it } from "bun:test"
import { headersFile, staticCacheControl } from "./static-headers.ts"

describe("staticCacheControl", () => {
  it("caches hashed bundles for a year and makes everything else revalidate", () => {
    expect(staticCacheControl("/index-4vw5rg5n.js")).toBe("public, max-age=31536000, immutable")
    expect(staticCacheControl("/index-wpgxfmf2.css")).toBe("public, max-age=31536000, immutable")
    expect(staticCacheControl("/favicon.svg")).toBe("no-cache")
    expect(staticCacheControl("/index.html")).toBe("no-cache")
    expect(staticCacheControl("/index-.js")).toBe("no-cache")
    expect(staticCacheControl("/nested/index-abc.js")).toBe("no-cache")
  })
})

describe("headersFile", () => {
  it("lists the headers for every file, sets noindex on each page below the home page and detaches no-cache from the hashed bundles", () => {
    expect(headersFile({ "X-Test": "1" })).toBe(
      [
        "/*",
        "  X-Test: 1",
        "  Cache-Control: no-cache",
        "/:segment",
        "  X-Robots-Tag: noindex, nofollow",
        "/g/*",
        "  X-Robots-Tag: noindex, nofollow",
        "/live/*",
        "  X-Robots-Tag: noindex, nofollow",
        "/overlay/*",
        "  X-Robots-Tag: noindex, nofollow",
        "/index-*.js",
        "  ! Cache-Control",
        "  Cache-Control: public, max-age=31536000, immutable",
        "/index-*.css",
        "  ! Cache-Control",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ].join("\n"),
    )
  })
})
