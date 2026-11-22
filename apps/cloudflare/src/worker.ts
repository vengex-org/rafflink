import { errorClass } from "@rafflink/core/lib/error-class"
import { AdminDirectory } from "@rafflink/core/admin/admin-directory"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { createApp, type AppDeps, type SpaTemplateLoader } from "@rafflink/core/http/create-app"
import { armRetentionAlarms } from "@rafflink/core/room/arm-retention"
import { deleteExpiredGiveaways } from "@rafflink/core/room/delete-giveaway"
import type { Hono } from "hono"
import { CacheApiPublicCache } from "./adapters/cache-api-public-cache.ts"
import { createUsageMeter } from "./adapters/cloudflare-usage-meter.ts"
import { DurableObjectRoomDirectory } from "./adapters/durable-object-room-directory.ts"
import {
  durableObjectPlanQueue,
  durableObjectTokenQueue,
} from "./adapters/durable-object-token-queue.ts"
import { RateLimitBindingLimiter, connectingAddress } from "./adapters/rate-limit-binding.ts"
import type { WorkerEnv } from "./env.ts"
import { runtimeOf } from "./runtime.ts"
import { createWorkerApp } from "./worker-app.ts"

export { GiveawayRoomObject } from "./durable-objects/giveaway-room-do.ts"
export { TokenQueueDO } from "./durable-objects/token-queue-do.ts"

const apps = new WeakMap<WorkerEnv, Promise<Hono>>()

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await appOf(env)).fetch(request)
  },

  /** The cron trigger of `wrangler.jsonc`. */
  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(validateTokens(env))
    ctx.waitUntil(armRetention(env))
    ctx.waitUntil(deleteExpiredHistory(env))
  },
}

function appOf(env: WorkerEnv): Promise<Hono> {
  const existing = apps.get(env)
  if (existing !== undefined) return existing
  const opened = openApp(env)
  apps.set(env, opened)
  return opened
}

async function openApp(env: WorkerEnv): Promise<Hono> {
  const runtime = await runtimeOf(env)
  const deps: AppDeps = {
    ...runtime,
    rooms: new DurableObjectRoomDirectory(env.ROOMS),
    queue: durableObjectTokenQueue(env.QUEUE),
    planQueue: durableObjectPlanQueue(env.QUEUE),
    usage: createUsageMeter(runtime.config, runtime.clock, (input, init) => fetch(input, init)),
    publicCache: new CacheApiPublicCache(caches.default),
    admins: new AdminDirectory(runtime.config, runtime.twitch),
    entryIpLimiter: new RateLimitBindingLimiter(env.ENTRY_IP_LIMITER),
    leavesIpLimiter: new RateLimitBindingLimiter(env.LEAVES_IP_LIMITER),
    clientAddress: connectingAddress,
  }
  return createWorkerApp({
    api: createApp(deps, indexTemplateOf(env.ASSETS, runtime.config.publicUrl)),
    rooms: env.ROOMS,
  })
}

/** The built `index.html` of the assets, for the pages `run_worker_first` sends to the Worker. */
function indexTemplateOf(assets: Fetcher, publicUrl: string): SpaTemplateLoader {
  return async () => {
    const response = await assets.fetch(new URL("/", publicUrl))
    if (!response.ok)
      throw new Error("the assets answered no index.html", { cause: response.status })
    return response.text()
  }
}

async function validateTokens(env: WorkerEnv): Promise<void> {
  try {
    console.info("streamer token validation", await validateStreamerTokens(await runtimeOf(env)))
  } catch (error) {
    console.error("streamer token validation failed", {
      errorClass: errorClass(error),
    })
  }
}

async function armRetention(env: WorkerEnv): Promise<void> {
  try {
    const { accounts, config } = await runtimeOf(env)
    const woken = await armRetentionAlarms(
      accounts,
      new DurableObjectRoomDirectory(env.ROOMS),
      config.entryRetentionSweepBatch,
      config.entryRetentionSweepMaxAttempts,
    )
    console.info("retention sweep", { woken })
  } catch (error) {
    console.error("retention sweep failed", { errorClass: errorClass(error) })
  }
}

// Unset HISTORY_RETENTION_DAYS keeps every giveaway, so the sweep neither runs nor logs.
async function deleteExpiredHistory(env: WorkerEnv): Promise<void> {
  try {
    const runtime = await runtimeOf(env)
    const days = runtime.config.historyRetentionDays
    if (days === null) return
    const deleted = await deleteExpiredGiveaways(
      { ...runtime, rooms: new DurableObjectRoomDirectory(env.ROOMS) },
      days,
    )
    console.info("history retention sweep", { deleted })
  } catch (error) {
    console.error("history retention sweep failed", { errorClass: errorClass(error) })
  }
}
