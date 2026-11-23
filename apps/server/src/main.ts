import { resolveConfig } from "@rafflink/core/config"
import { join } from "node:path"
import { startErrorReporting } from "./error-reporting.ts"
import { startServer } from "./start-server.ts"
import { close } from "@sentry/core"

// Docker stops a container 10 seconds after SIGTERM; the server's own stop needs the rest.
const sentryCloseTimeoutMs = 2000

const config = resolveConfig(process.env)
await startErrorReporting(config)
// The dev SPA is imported only in dev: a production server serves the built files and never bundles.
const devSpa = config.devFakeTwitch ? (await import("@rafflink/web/index.html")).default : null
const staticDir = devSpa === null ? join(import.meta.dir, "../../web/dist") : null
const devPublicDir = devSpa === null ? null : join(import.meta.dir, "../../web/public")

const server = await startServer({ config, staticDir, devSpa, devPublicDir })
console.info("rafflink listening", { url: server.url.href, devFakeTwitch: config.devFakeTwitch })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // `close` sends the error reports still queued; without an SDK it returns at once.
    void server
      .stop()
      .then(() => close(sentryCloseTimeoutMs))
      .then(() => process.exit(0))
  })
}
