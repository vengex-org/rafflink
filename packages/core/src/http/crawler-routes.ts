import { Hono } from "hono"
import type { AppDeps } from "./deps.ts"

/** What the pages carry for crawlers: only the home page is listed; giveaway pages answer `X-Robots-Tag: noindex`. */
export function crawlerRoutes(deps: Pick<AppDeps, "config">): Hono {
  const { publicUrl } = deps.config
  const app = new Hono()

  // Giveaway pages stay crawlable on purpose: a crawler that may not fetch a page never sees its noindex.
  app.get("/robots.txt", (c) =>
    c.text(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /auth/",
        "Disallow: /dashboard",
        "Disallow: /live/",
        "Disallow: /overlay/",
        "Disallow: /admin",
        "",
        `Sitemap: ${publicUrl}/sitemap.xml`,
        "",
      ].join("\n"),
    ),
  )

  app.get("/sitemap.xml", (c) =>
    c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${publicUrl}/</loc></url></urlset>\n`,
      200,
      { "Content-Type": "application/xml; charset=UTF-8" },
    ),
  )

  return app
}
