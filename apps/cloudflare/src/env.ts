import type { GiveawayRoomObject } from "./durable-objects/giveaway-room-do.ts"
import type { TokenQueueDO } from "./durable-objects/token-queue-do.ts"

/** The bindings of `wrangler.jsonc`; the plain string values of the environment are the settings of `resolveConfig`. */
export interface WorkerEnv {
  readonly ASSETS: Fetcher
  readonly DB: D1Database
  readonly ROOMS: DurableObjectNamespace<GiveawayRoomObject>
  readonly QUEUE: DurableObjectNamespace<TokenQueueDO>
  readonly ENTRY_USER_LIMITER: RateLimit
  readonly ENTRY_IP_LIMITER: RateLimit
  readonly LEAVES_IP_LIMITER: RateLimit
  readonly MODERATOR_IP_LIMITER: RateLimit
}

/**
 * What the caches built once per isolate are keyed by. Not `env` itself: the Sentry wrappers hand every request
 * and every Durable Object a new proxy of it, while the D1 binding they return stays the same object.
 */
export function isolateKeyOf(env: WorkerEnv): object {
  return env.DB
}

/** The string values of the environment: variables and secrets, without the bindings. */
export function settingsOf(env: WorkerEnv): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string") settings[name] = value
  }
  return settings
}
