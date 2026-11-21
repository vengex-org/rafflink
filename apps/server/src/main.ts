import { resolveConfig } from "@rafflink/core/config"
import { join } from "node:path"
import { startServer } from "./start-server.ts"

const config = resolveConfig(process.env)
// The dev SPA is imported only in dev: a production server serves the built files and never bundles.
const devSpa = config.devFakeTwitch ? (await import("@rafflink/web/index.html")).default : null
const staticDir = devSpa === null ? join(import.meta.dir, "../../web/dist") : null
const devPublicDir = devSpa === null ? null : join(import.meta.dir, "../../web/public")

const server = await startServer({ config, staticDir, devSpa, devPublicDir })
console.info("rafflink listening", { url: server.url.href, devFakeTwitch: config.devFakeTwitch })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop().then(() => process.exit(0))
  })
}
