import type { GiveawayRoomObject } from "./durable-objects/giveaway-room-do.ts"
import type { TokenQueueDO } from "./durable-objects/token-queue-do.ts"

/** The bindings of `wrangler.jsonc`; the plain string values of the environment are the settings of `resolveConfig`. */
export interface WorkerEnv {
  readonly DB: D1Database
  readonly ROOMS: DurableObjectNamespace<GiveawayRoomObject>
  readonly QUEUE: DurableObjectNamespace<TokenQueueDO>
  readonly ENTRY_USER_LIMITER: RateLimit
  readonly ENTRY_IP_LIMITER: RateLimit
  readonly LEAVES_IP_LIMITER: RateLimit
}

/** The string values of the environment: variables and secrets, without the bindings. */
export function settingsOf(env: WorkerEnv): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string") settings[name] = value
  }
  return settings
}
