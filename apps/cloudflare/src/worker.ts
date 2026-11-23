import { errorClass } from "@rafflink/core/lib/error-class"
import { sentryOptions } from "@rafflink/core/lib/error-reporting"
import {
  captureException,
  instrumentDurableObjectWithSentry,
  withSentry,
  type CloudflareOptions,
} from "@sentry/cloudflare"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { createApp, type AppDeps, type WebFileLoader } from "@rafflink/core/http/create-app"
import { servedPath } from "@rafflink/core/lib/page-paths"
import { armRetentionAlarms } from "@rafflink/core/room/arm-retention"
import { deleteExpiredGiveaways } from "@rafflink/core/room/delete-giveaway"
import type { RateLimiter } from "@rafflink/core/ports"
import type { Hono } from "hono"
import { CacheApiPublicCache } from "./adapters/cache-api-public-cache.ts"
import { createUsageMeter } from "./adapters/cloudflare-usage-meter.ts"
import { DurableObjectRoomDirectory } from "./adapters/durable-object-room-directory.ts"
import {
  durableObjectPlanQueue,
  durableObjectTokenQueue,
} from "./adapters/durable-object-token-queue.ts"
import { RateLimitBindingLimiter, connectingAddress } from "./adapters/rate-limit-binding.ts"
import { durableObjectSitePresence } from "./adapters/durable-object-site-presence.ts"
import { GiveawayRoomObject as GiveawayRoom } from "./durable-objects/giveaway-room-do.ts"
import { SitePresenceObject as SitePresence } from "./durable-objects/site-presence-do.ts"
import { TokenQueueDO as TokenQueue } from "./durable-objects/token-queue-do.ts"
import { isolateKeyOf, type WorkerEnv } from "./env.ts"
import { configOf, runtimeOf } from "./runtime.ts"
import { sentryReportError } from "./adapters/sentry-report-error.ts"
import { createWorkerApp } from "./worker-app.ts"

// Without a DSN the SDK is disabled and builds no transport.
function sentryOptionsOf(env: WorkerEnv): CloudflareOptions {
  return sentryOptions(configOf(env)) ?? { enabled: false }
}

// The class names are the `class_name`s of wrangler.jsonc.
export const GiveawayRoomObject = instrumentDurableObjectWithSentry(sentryOptionsOf, GiveawayRoom)
export const TokenQueueDO = instrumentDurableObjectWithSentry(sentryOptionsOf, TokenQueue)
export const SitePresenceObject = instrumentDurableObjectWithSentry(sentryOptionsOf, SitePresence)

const apps = new WeakMap<object, Promise<Hono>>()

// The presence limiter of a deployment without its binding: the presence route is off there anyway.
const noLimit: RateLimiter = { allow: async () => true }

export default withSentry(sentryOptionsOf, {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await appOf(env)).fetch(request)
  },

  /** The cron trigger of `wrangler.jsonc`. */
  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(validateTokens(env))
    ctx.waitUntil(armRetention(env))
    ctx.waitUntil(deleteExpiredHistory(env))
  },
} satisfies ExportedHandler<WorkerEnv>)

function appOf(env: WorkerEnv): Promise<Hono> {
  const key = isolateKeyOf(env)
  const existing = apps.get(key)
  if (existing !== undefined) return existing
  const opened = openApp(env)
  apps.set(key, opened)
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
    entryIpLimiter: new RateLimitBindingLimiter(env.ENTRY_IP_LIMITER),
    leavesIpLimiter: new RateLimitBindingLimiter(env.LEAVES_IP_LIMITER),
    moderatorIpLimiter: new RateLimitBindingLimiter(env.MODERATOR_IP_LIMITER),
    clientAddress: connectingAddress,
    reportError: sentryReportError,
    presence: env.PRESENCE === undefined ? null : durableObjectSitePresence(env.PRESENCE),
    presenceIpLimiter:
      env.PRESENCE_IP_LIMITER === undefined
        ? noLimit
        : new RateLimitBindingLimiter(env.PRESENCE_IP_LIMITER),
  }
  return createWorkerApp({
    api: createApp(deps, webFilesOf(env.ASSETS, runtime.config.publicUrl)),
    rooms: env.ROOMS,
    presence: env.PRESENCE ?? null,
  })
}

/**
 * The files of the web build in the assets, for the pages `run_worker_first` sends to the Worker. An HTML file is
 * asked for at the address the assets serve it under, since its own name redirects there.
 */
function webFilesOf(assets: Fetcher, publicUrl: string): WebFileLoader {
  return async (file) => {
    const response = await assets.fetch(new URL(servedPath(file), publicUrl))
    // A build without prerendered pages has no manifest; every deployment has its app shell.
    if (response.status === 404 && file !== "index.html") return null
    if (!response.ok) throw new Error("the assets answered no file", { cause: response.status })
    return response.text()
  }
}

async function validateTokens(env: WorkerEnv): Promise<void> {
  try {
    console.info("streamer token validation", await validateStreamerTokens(await runtimeOf(env)))
  } catch (error) {
    captureException(error)
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
    captureException(error)
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
    captureException(error)
    console.error("history retention sweep failed", { errorClass: errorClass(error) })
  }
}
