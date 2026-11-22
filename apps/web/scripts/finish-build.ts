import { cpSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { securityHeaders } from "@rafflink/core/http/security-headers"
import { headersFile } from "@rafflink/core/http/static-headers"
import { inlineScriptHashes } from "@rafflink/core/lib/spa-html"

// Runs after `bun build`: adds the files the bundler does not know and the `_headers` of Cloudflare assets.
// Another repo building this app passes its own output and public directories: `finish-build.ts [distDir] [publicDir]`.
const [distArg, publicArg] = Bun.argv.slice(2)
const dist = resolve(distArg ?? fileURLToPath(new URL("../dist/", import.meta.url)))
const publicDir = resolve(publicArg ?? fileURLToPath(new URL("../public/", import.meta.url)))

// The bundler copies only the files `index.html` links; the manifest names the rest.
cpSync(publicDir, dist, { recursive: true })

const html = await Bun.file(join(dist, "index.html")).text()
const scriptHashes = await inlineScriptHashes(html)
// Cloudflare serves https only, so HSTS is always safe here; the Worker and the Bun server decide per PUBLIC_URL.
await Bun.write(join(dist, "_headers"), headersFile(securityHeaders({ hsts: true, scriptHashes })))
console.info("web build finished", { scriptHashes: scriptHashes.length })
