import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ContractTarget, StartTarget } from "@rafflink/core/test/contract"
import { Log, LogLevel, Miniflare, PeriodType } from "miniflare"
import { bundleWorker } from "../src/build/bundle-worker.ts"
import { readWranglerConfig, type WranglerConfig } from "./wrangler-config.ts"

const d1Binding = "DB"

/**
 * Starts the bundled Worker in Miniflare with its own in-memory D1 database and Durable Object
 * storage. `env` becomes the Worker's variables, `webDir` its static assets; the Worker reaches the fake Twitch on the host through
 * the network service, which allows loopback addresses.
 */
export const startWorker: StartTarget = async (env, webDir) => {
  const [bundle, wrangler] = await Promise.all([bundleWorker(), readWranglerConfig()])
  const miniflare = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.js", contents: bundle }],
    compatibilityDate: wrangler.compatibilityDate,
    compatibilityFlags: [...wrangler.compatibilityFlags],
    d1Databases: [d1Binding],
    durableObjects: {
      ROOMS: { className: "GiveawayRoomObject", useSQLite: true },
      QUEUE: { className: "TokenQueueDO", useSQLite: true },
    },
    // The assets and the paths that run the Worker first are the ones of wrangler.jsonc; `_headers` is read from the folder.
    assets: {
      binding: wrangler.assetsBinding,
      directory: webDir,
      assetConfig: { not_found_handling: wrangler.notFoundHandling },
      routerConfig: {
        has_user_worker: true,
        static_routing: { user_worker: [...wrangler.runWorkerFirst] },
      },
    },
    bindings: env,
    ratelimits: rateLimitsOf(env, wrangler.rateLimits),
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

// The limit of a binding is fixed in wrangler.jsonc; the contract sets the same keys the Bun server reads, so a scenario can lower them.
function rateLimitsOf(
  env: Record<string, string>,
  configured: WranglerConfig["rateLimits"],
): Record<string, { namespace_id: string; simple: { limit: number; period: PeriodType } }> {
  const overrides: Record<string, string | undefined> = {
    ENTRY_USER_LIMITER: env.ENTRY_USER_LIMIT_PER_MINUTE,
    ENTRY_IP_LIMITER: env.ENTRY_IP_LIMIT_PER_MINUTE,
    LEAVES_IP_LIMITER: env.LEAVES_IP_LIMIT_PER_MINUTE,
    MODERATOR_IP_LIMITER: env.MODERATOR_IP_LIMIT_PER_MINUTE,
  }
  return Object.fromEntries(
    Object.entries(configured).map(([name, { namespaceId, limit }]) => {
      const override = overrides[name]
      return [
        name,
        {
          namespace_id: namespaceId,
          simple: {
            limit: override === undefined ? limit : Number(override),
            period: PeriodType.MINUTE,
          },
        },
      ]
    }),
  )
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
