import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import { resolveConfig, type ResolvedConfig } from "@rafflink/core/config"
import { openKeyRing } from "@rafflink/core/lib/seal"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { D1AsyncSql } from "./adapters/d1-async-sql.ts"
import { settingsOf, type WorkerEnv } from "./env.ts"

/** What the Worker and both Durable Objects share, built once per isolate from the environment. */
export interface Runtime extends StreamerTokenDeps {
  readonly config: ResolvedConfig
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
  return {
    config,
    clock: systemClock,
    random: systemRandom,
    // Called through a wrapper: the global `fetch` throws when it is called as a method of another object.
    twitch: new TwitchClient(config, (input, init) => fetch(input, init)),
    accounts: new AccountStore(new D1AsyncSql(env.DB), config),
    keyRing: await openKeyRing(config.tokenSealKeys),
  }
}
