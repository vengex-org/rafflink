import { AccountStore } from "@rafflink/core/accounts/account-store"
import { DrandBeacon } from "@rafflink/core/beacon/drand-beacon"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import { resolveConfig, type ResolvedConfig } from "@rafflink/core/config"
import { openKeyRing } from "@rafflink/core/lib/seal"
import type { RandomnessBeacon } from "@rafflink/core/ports"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { StatsStore } from "@rafflink/core/stats/stats-store"
import { AdminDirectory } from "@rafflink/core/admin/admin-directory"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { TwitchProvider } from "@rafflink/core/twitch/twitch-provider"
import { kickPlatform } from "@rafflink/core/kick/kick-provider"
import { D1AsyncSql } from "./adapters/d1-async-sql.ts"
import { RateLimitBindingLimiter } from "./adapters/rate-limit-binding.ts"
import { isolateKeyOf, settingsOf, type WorkerEnv } from "./env.ts"

/** What the Worker and both Durable Objects share, built once per isolate from the environment. */
export interface Runtime extends StreamerTokenDeps {
  readonly config: ResolvedConfig
  readonly entryUserLimiter: RateLimitBindingLimiter
  readonly beacon: RandomnessBeacon
  readonly stats: StatsStore
  readonly admins: AdminDirectory
}

const configs = new WeakMap<object, ResolvedConfig>()
const runtimes = new WeakMap<object, Promise<Runtime>>()

/** The settings of the environment, parsed once per isolate; the Sentry wrappers read them on every request. */
export function configOf(env: WorkerEnv): ResolvedConfig {
  const key = isolateKeyOf(env)
  const existing = configs.get(key)
  if (existing !== undefined) return existing
  const config = resolveConfig(settingsOf(env))
  configs.set(key, config)
  return config
}

export function runtimeOf(env: WorkerEnv): Promise<Runtime> {
  const key = isolateKeyOf(env)
  const existing = runtimes.get(key)
  if (existing !== undefined) return existing
  const opened = openRuntime(env)
  runtimes.set(key, opened)
  return opened
}

async function openRuntime(env: WorkerEnv): Promise<Runtime> {
  const config = configOf(env)
  const sql = new D1AsyncSql(env.DB)
  // Called through a wrapper: the global `fetch` throws when it is called as a method of another object.
  const twitch = new TwitchClient(config, (input, init) => fetch(input, init))
  return {
    config,
    clock: systemClock,
    random: systemRandom,
    platforms: {
      twitch: new TwitchProvider(twitch, systemClock, config),
      ...kickPlatform(config, (input, init) => fetch(input, init), systemClock, sql),
    },
    admins: new AdminDirectory(config, twitch),
    beacon: new DrandBeacon(config, (input, init) => fetch(input, init), systemRandom),
    accounts: new AccountStore(sql, config),
    stats: new StatsStore(sql, config),
    keyRing: await openKeyRing(config.tokenSealKeys),
    entryUserLimiter: new RateLimitBindingLimiter(env.ENTRY_USER_LIMITER),
  }
}
