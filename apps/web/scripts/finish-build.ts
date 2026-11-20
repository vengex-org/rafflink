import { cpSync } from "node:fs"
import { securityHeaders } from "@rafflink/core/http/security-headers"
import { headersFile } from "@rafflink/core/http/static-headers"
import { inlineScriptHashes } from "@rafflink/core/lib/spa-html"

// Runs after `bun build`: adds the files the bundler does not know and the `_headers` of Cloudflare assets.
const dist = new URL("../dist/", import.meta.url)

// The bundler copies only the files `index.html` links; the manifest names the rest.
cpSync(new URL("../public/", import.meta.url), dist, { recursive: true })

const html = await Bun.file(new URL("index.html", dist)).text()
const scriptHashes = await inlineScriptHashes(html)
// Cloudflare serves https only, so HSTS is always safe here; the Worker and the Bun server decide per PUBLIC_URL.
await Bun.write(
  new URL("_headers", dist),
  headersFile(securityHeaders({ hsts: true, scriptHashes })),
)
console.info("web build finished", { scriptHashes: scriptHashes.length })
