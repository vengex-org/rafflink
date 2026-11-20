import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The body of the inline script of {@link spaTemplate}, as the browser hashes it. */
export const inlineScript = `
      document.documentElement.dataset.theme = "light"
    `

/** The tags of the built `index.html` that core rewrites, with the title and description of the home page. */
export const spaTemplate = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Rafflink home</title>
    <meta name="description" content="Home description" />
    <link rel="canonical" href="/" />
    <meta property="og:title" content="Rafflink home" />
    <meta property="og:description" content="Home description" />
    <meta property="og:url" content="/" />
    <meta property="og:image" content="/icon-512.png" />
    <meta name="twitter:title" content="Rafflink home" />
    <meta name="twitter:description" content="Home description" />
    <meta name="twitter:image" content="/icon-512.png" />
    <script>${inlineScript}</script>
    <script type="module" crossorigin src="/index-abc12345.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

/** A temporary folder holding {@link spaTemplate} as `index.html`; the returned function removes it. */
export function webFixture(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "rafflink-web-"))
  writeFileSync(join(path, "index.html"), spaTemplate)
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
