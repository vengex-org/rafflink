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
import { settingsOf, type WorkerEnv } from "./env.ts"

/** What the Worker and both Durable Objects share, built once per isolate from the environment. */
export interface Runtime extends StreamerTokenDeps {
  readonly config: ResolvedConfig
  readonly entryUserLimiter: RateLimitBindingLimiter
  readonly beacon: RandomnessBeacon
  readonly stats: StatsStore
  readonly admins: AdminDirectory
}

const runtimes = new WeakMap<WorkerEnv, Promise<Runtime>>()

export function runtimeOf(env: WorkerEnv): Promise<Runtime> {
  const existing = runtimes.get(env)
  if (existing !== undefined) return existing
  const opened = openRuntime(env)
  runtimes.set(env, opened)
  return opened
}

async function openRuntime(env: WorkerEnv): Promise<Runtime> {
  const config = resolveConfig(settingsOf(env))
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
