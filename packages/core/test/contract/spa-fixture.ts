import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { WebFileLoader } from "../../src/http/create-app.ts"
import { securityHeaders } from "../../src/http/security-headers.ts"
import { headersFile } from "../../src/http/static-headers.ts"
import {
  localizedPath,
  prerenderFile,
  prerenderManifest,
  prerenderManifestFile,
  type PrerenderedPage,
} from "../../src/lib/page-paths.ts"
import { withoutRobotsMeta } from "../../src/lib/spa-html.ts"

/** The body of the inline script of {@link spaTemplate}, as the browser hashes it. */
export const inlineScript = `
      document.documentElement.dataset.theme = "light"
    `

/** The CSP source of {@link inlineScript}. */
export const inlineScriptSource = `'sha256-${createHash("sha256").update(inlineScript).digest("base64")}'`

/** The tags of the built `index.html` that core rewrites, with the title and description of the home page, and its robots meta. */
export const spaTemplate = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Rafflink home</title>
    <meta name="description" content="Home description" />
    <link rel="canonical" href="/" />
    <meta property="og:title" content="Rafflink home" />
    <meta property="og:description" content="Home description" />
    <meta property="og:url" content="/" />
    <meta property="og:image" content="/og.png" />
    <meta name="twitter:title" content="Rafflink home" />
    <meta name="twitter:description" content="Home description" />
    <meta name="twitter:image" content="/og.png" />
    <script>${inlineScript}</script>
    <script type="module" crossorigin src="/index-abc12345.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

/** The robots meta of {@link spaTemplate}, which the pages search engines may index leave out. */
export const robotsMeta = `<meta name="robots" content="noindex, nofollow" />`

/** Pages as the web build prerenders them: the English home page, a localized home page and a localized legal page. */
export const prerenderedPages: readonly PrerenderedPage[] = [
  { path: localizedPath("en", "home"), file: prerenderFile("en", "home") },
  { path: localizedPath("de", "home"), file: prerenderFile("de", "home") },
  { path: localizedPath("de", "privacy"), file: prerenderFile("de", "privacy") },
]

/** The page the build prerendered for `path`: the shell without its robots meta, with a heading naming the path in `#root`. */
export function prerenderedHtml(path: string): string {
  return withoutRobotsMeta(spaTemplate).replace(
    `<div id="root"></div>`,
    `<div id="root"><h1>Prerendered ${path}</h1></div>`,
  )
}

/** A web build of these files, by their path relative to the build's root. */
export function webBuild(files: Readonly<Record<string, string>>): WebFileLoader {
  return async (file) => files[file] ?? null
}

/** The header of an ICO file with no images: the targets answer `/favicon.ico` by its name, not its content. */
const emptyIcon = new Uint8Array([0, 0, 1, 0, 0, 0])

/**
 * A temporary folder holding {@link spaTemplate} as `index.html`, the {@link prerenderedPages} with their manifest,
 * a `favicon.ico` and the `_headers` the web build writes for them; the returned function removes it.
 */
export function webFixture(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "rafflink-web-"))
  writeFileSync(join(path, "index.html"), spaTemplate)
  for (const page of prerenderedPages) {
    mkdirSync(dirname(join(path, page.file)), { recursive: true })
    writeFileSync(join(path, page.file), prerenderedHtml(page.path))
  }
  writeFileSync(join(path, prerenderManifestFile), prerenderManifest(prerenderedPages))
  writeFileSync(join(path, "favicon.ico"), emptyIcon)
  const scriptHashes = [inlineScriptSource.slice(1, -1)]
  writeFileSync(
    join(path, "_headers"),
    headersFile(securityHeaders({ hsts: true, scriptHashes, errorReportOrigin: null })),
  )
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
