import { errorClass } from "@rafflink/core/lib/error-class"
import { AdminDirectory } from "@rafflink/core/admin/admin-directory"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { createApp, type AppDeps } from "@rafflink/core/http/create-app"
import { armRetentionAlarms } from "@rafflink/core/room/arm-retention"
import type { Hono } from "hono"
import { CacheApiPublicCache } from "./adapters/cache-api-public-cache.ts"
import { createUsageMeter } from "./adapters/cloudflare-usage-meter.ts"
import { DurableObjectRoomDirectory } from "./adapters/durable-object-room-directory.ts"
import { durableObjectTokenQueue } from "./adapters/durable-object-token-queue.ts"
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
    usage: createUsageMeter(runtime.config, runtime.clock, (input, init) => fetch(input, init)),
    publicCache: new CacheApiPublicCache(caches.default),
    admins: new AdminDirectory(runtime.config, runtime.twitch),
    entryIpLimiter: new RateLimitBindingLimiter(env.ENTRY_IP_LIMITER),
    clientAddress: connectingAddress,
  }
  return createWorkerApp({ api: createApp(deps, null), rooms: env.ROOMS })
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
    )
    console.info("retention sweep", { woken })
  } catch (error) {
    console.error("retention sweep failed", { errorClass: errorClass(error) })
  }
}
