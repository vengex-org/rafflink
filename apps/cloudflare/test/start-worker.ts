import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ContractTarget, StartTarget } from "@rafflink/core/test/contract"
import { Log, LogLevel, Miniflare } from "miniflare"
import { bundleWorker } from "../src/build/bundle-worker.ts"
import { readWranglerConfig } from "./wrangler-config.ts"

const d1Binding = "DB"

/**
 * Starts the bundled Worker in Miniflare with its own in-memory D1 database and Durable Object
 * storage. `env` becomes the Worker's variables; the Worker reaches the fake Twitch on the host through
 * the network service, which allows loopback addresses.
 */
export const startWorker: StartTarget = async (env) => {
  const [bundle, wrangler] = await Promise.all([bundleWorker(), readWranglerConfig()])
  const miniflare = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.js", contents: bundle }],
    compatibilityDate: wrangler.compatibilityDate,
    compatibilityFlags: [...wrangler.compatibilityFlags],
    d1Databases: [d1Binding],
    durableObjects: {
      ROOMS: { className: "GiveawayRoomDO", useSQLite: true },
      QUEUE: { className: "TokenQueueDO", useSQLite: true },
    },
    bindings: env,
    outboundService: { network: { allow: ["public", "private", "local"], deny: [] } },
    // Info and warnings of the Worker are expected traffic of the scenarios; errors stay visible.
    log: new Log(LogLevel.ERROR),
    host: "127.0.0.1",
    port: 0,
  })
  try {
    await applyAccountsMigrations(miniflare)
    const [url, worker] = await Promise.all([miniflare.ready, miniflare.getWorker()])
    return target(miniflare, url, worker, wrangler.crons)
  } catch (error) {
    await miniflare.dispose()
    throw error
  }
}

function target(
  miniflare: Miniflare,
  url: URL,
  worker: Awaited<ReturnType<Miniflare["getWorker"]>>,
  crons: readonly string[],
): ContractTarget {
  const [cron] = crons
  if (cron === undefined) throw new TypeError("wrangler.jsonc has no cron trigger")
  return {
    url,
    stop: () => miniflare.dispose(),
    runValidateJob: async () => {
      const result = await worker.scheduled({ cron })
      if (result.outcome !== "ok")
        throw new Error(`the scheduled handler ended with ${result.outcome}`)
    },
  }
}

/** The same files `wrangler d1 migrations apply` runs, split into statements as the Bun server's runner does. */
async function applyAccountsMigrations(miniflare: Miniflare): Promise<void> {
  const corePackage = fileURLToPath(import.meta.resolve("@rafflink/core/package.json"))
  const dir = join(dirname(corePackage), "schema", "accounts")
  const db = await miniflare.getD1Database(d1Binding)
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .toSorted()) {
    const statements = readFileSync(join(dir, name), "utf8")
      .split(";")
      .filter((statement) => statement.trim() !== "")
    await db.batch(statements.map((statement) => db.prepare(statement)))
  }
}
