import { cpSync } from "node:fs"
import { join } from "node:path"
import { resolveWebErrorReporting } from "@rafflink/core/config"
import { securityHeaders } from "@rafflink/core/http/security-headers"
import { headersFile } from "@rafflink/core/http/static-headers"
import {
  errorReportOrigin,
  inlineScriptHashes,
  withErrorReportingMeta,
} from "@rafflink/core/lib/spa-html"
import { resolveDirs } from "./resolve-dirs.ts"

// Runs after `bun build`: adds the files the bundler does not know and the `_headers` of Cloudflare assets.
// Another repo building this app passes its own output and public directories: `finish-build.ts [distDir] [publicDir]`.
const { dist, publicDir } = resolveDirs(Bun.argv.slice(2))

// The bundler copies only the files `index.html` links; the manifest names the rest.
cpSync(publicDir, dist, { recursive: true })

const errorReporting = resolveWebErrorReporting(process.env)
const indexPath = join(dist, "index.html")
const html = withErrorReportingMeta(await Bun.file(indexPath).text(), errorReporting)
await Bun.write(indexPath, html)
const scriptHashes = await inlineScriptHashes(html)
// Cloudflare serves https only, so HSTS is always safe here; the Worker and the Bun server decide per PUBLIC_URL.
const headers = securityHeaders({
  hsts: true,
  scriptHashes,
  errorReportOrigin: errorReportOrigin(html),
})
await Bun.write(join(dist, "_headers"), headersFile(headers))
console.info("web build finished", {
  scriptHashes: scriptHashes.length,
  errorReporting: errorReporting.sentryDsn !== null,
})
