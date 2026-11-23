import { rmSync } from "node:fs"
import { join } from "node:path"
import type { WebPrerenderConfig } from "@rafflink/core/config"
import { operatorOf } from "@rafflink/core/http/session-routes"
import { languages, sourceLanguage, type Language } from "@rafflink/core/lib/languages"
import {
  alternates,
  legalDataElementId,
  localizedPages,
  localizedPath,
  parsePrerenderManifest,
  prerenderFile,
  prerenderManifest,
  prerenderManifestFile,
  servedPath,
  type LocalizedPage,
  type PrerenderedPage,
} from "@rafflink/core/lib/page-paths"
import {
  embedJson,
  embedJsonLd,
  renderSpaHtml,
  withoutRobotsMeta,
} from "@rafflink/core/lib/spa-html"
import { renderToString } from "react-dom/server"
import { StaticRouter } from "react-router"
import { AppRoutes } from "../src/app.tsx"
import { loadDictionary, type MessageKey } from "../src/i18n/dictionaries.ts"
import { repositoryUrl } from "../src/lib/links.ts"
import { builtLegalData, PrerenderedLegal } from "../src/pages/legal-page.tsx"

/** A page the build renders: its address, its file and its HTML. */
export interface RenderedPage extends PrerenderedPage {
  readonly language: Language
  readonly page: LocalizedPage
  readonly html: string
}

export const sitemapFile = "sitemap.xml"

/**
 * Writes every localized page in every language into `dist`, with the manifest, `sitemap.xml` and its line in
 * `robots.txt`; without a config it writes none. It first removes what an earlier build in `dist` prerendered, so
 * no page keeps an operator the build no longer has.
 */
export async function writePrerender(
  dist: string,
  shell: string,
  config: WebPrerenderConfig | null,
): Promise<readonly RenderedPage[]> {
  await removePrerendered(dist)
  if (config === null) return []
  const pages = await prerender(shell, config)
  for (const { file, html } of pages) await Bun.write(join(dist, file), html)
  await Bun.write(join(dist, prerenderManifestFile), prerenderManifest(pages))
  await Bun.write(join(dist, sitemapFile), sitemap(config.publicUrl, pages))
  const robots = Bun.file(join(dist, "robots.txt"))
  await Bun.write(robots, `${await robots.text()}${robotsLines(config.publicUrl)}`)
  return pages
}

/**
 * Renders each localized page in each language into the app shell: its markup in `#root`, its language, title,
 * description and absolute addresses in the head, the hreflang alternates, and on the English home page the
 * structured data search engines read. The robots meta of the shell is left out. A legal page carries the
 * operator it was rendered with, which the browser reads back while it hydrates.
 */
export async function prerender(
  shell: string,
  config: WebPrerenderConfig,
): Promise<RenderedPage[]> {
  const { publicUrl } = config
  const operator = operatorOf(config)
  const pages: RenderedPage[] = []
  for (const language of languages) {
    const dictionary = await loadDictionary(language)
    for (const page of localizedPages) {
      const path = localizedPath(language, page)
      const legal = page === "home" ? null : builtLegalData(operator, language)
      const markup = renderToString(
        <PrerenderedLegal value={legal}>
          <StaticRouter location={path}>
            <AppRoutes />
          </StaticRouter>
        </PrerenderedLegal>,
      )
      const { title, description } = metaKeys[page]
      let html = renderSpaHtml(withoutRobotsMeta(shell), {
        url: `${publicUrl}${path}`,
        image: `${publicUrl}/og.png`,
        text: { title: dictionary[title], description: dictionary[description] },
      })
      html = replaceRequired(html, /<html lang="[^"]*">/, `<html lang="${language}">`)
      html = html.replace("</head>", () => `${alternateLinks(publicUrl, page)}</head>`)
      if (legal !== null) html = embedJson(html, legalDataElementId, path, JSON.stringify(legal))
      if (page === "home" && language === sourceLanguage) {
        html = embedJsonLd(
          html,
          JSON.stringify(softwareApplication(publicUrl, dictionary[description])),
        )
      }
      html = replaceRequired(html, /<div id="root"><\/div>/, `<div id="root">${markup}</div>`)
      pages.push({ path, file: prerenderFile(language, page), language, page, html })
    }
  }
  return pages
}

const metaKeys = {
  home: { title: "meta.home.title", description: "meta.home.description" },
  privacy: { title: "meta.privacy.title", description: "meta.privacy.description" },
  terms: { title: "meta.terms.title", description: "meta.terms.description" },
} as const satisfies Readonly<
  Record<LocalizedPage, { readonly title: MessageKey; readonly description: MessageKey }>
>

async function removePrerendered(dist: string): Promise<void> {
  const manifest = Bun.file(join(dist, prerenderManifestFile))
  if (!(await manifest.exists())) return
  for (const file of parsePrerenderManifest(await manifest.text()).values()) {
    rmSync(join(dist, file), { force: true })
  }
  rmSync(join(dist, prerenderManifestFile))
  rmSync(join(dist, sitemapFile), { force: true })
}

/** The shell must keep the tags the prerender fills; a build whose shell lost one fails rather than writing a broken page. */
function replaceRequired(html: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(html))
    throw new Error("the app shell lacks a tag the prerender fills", { cause: pattern.source })
  return html.replace(pattern, () => replacement)
}

// PUBLIC_URL is an origin and the paths are the page model's, so neither needs escaping in an attribute.
function alternateLinks(publicUrl: string, page: LocalizedPage): string {
  return alternates(page)
    .map(
      ({ hreflang, path }) =>
        `<link rel="alternate" hreflang="${hreflang}" href="${publicUrl}${path}" />`,
    )
    .join("")
}

/** No ratings: Google shows no rich result without them, and Rafflink has none to state. */
function softwareApplication(publicUrl: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Rafflink",
    url: `${publicUrl}/`,
    description,
    applicationCategory: "EntertainmentApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    inLanguage: languages,
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    codeRepository: repositoryUrl,
  }
}

function sitemap(publicUrl: string, pages: readonly RenderedPage[]): string {
  const urls = pages.map(({ path, page }) => {
    const links = alternates(page).map(
      ({ hreflang, path: alternate }) =>
        `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${publicUrl}${alternate}"/>`,
    )
    return `<url><loc>${publicUrl}${path}</loc>${links.join("")}</url>`
  })
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    ...urls,
    "</urlset>",
    "",
  ].join("\n")
}

// The English home page is a file of its own, since `index.html` stays the shell; it is reachable at its file's
// address too, where it names `/` as canonical and crawlers are asked not to go.
function robotsLines(publicUrl: string): string {
  const englishHome = servedPath(prerenderFile(sourceLanguage, "home"))
  return `Disallow: ${englishHome}\n\nSitemap: ${publicUrl}/${sitemapFile}\n`
}
