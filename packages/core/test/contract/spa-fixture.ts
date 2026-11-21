import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { securityHeaders } from "../../src/http/security-headers.ts"
import { headersFile } from "../../src/http/static-headers.ts"

/** The body of the inline script of {@link spaTemplate}, as the browser hashes it. */
export const inlineScript = `
      document.documentElement.dataset.theme = "light"
    `

/** The CSP source of {@link inlineScript}. */
export const inlineScriptSource = `'sha256-${createHash("sha256").update(inlineScript).digest("base64")}'`

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

/** The header of an ICO file with no images: the targets answer `/favicon.ico` by its name, not its content. */
const emptyIcon = new Uint8Array([0, 0, 1, 0, 0, 0])

/** A temporary folder holding {@link spaTemplate} as `index.html`, a `favicon.ico` and the `_headers` the web build writes for them; the returned function removes it. */
export function webFixture(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "rafflink-web-"))
  writeFileSync(join(path, "index.html"), spaTemplate)
  writeFileSync(join(path, "favicon.ico"), emptyIcon)
  const scriptHashes = [inlineScriptSource.slice(1, -1)]
  writeFileSync(join(path, "_headers"), headersFile(securityHeaders({ hsts: true, scriptHashes })))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
