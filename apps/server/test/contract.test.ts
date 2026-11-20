import { afterEach, beforeEach, spyOn } from "bun:test"
import { join } from "node:path"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { resolveConfig } from "@rafflink/core/config"
import { openKeyRing } from "@rafflink/core/lib/seal"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { BunSqliteAsyncSql } from "@rafflink/core/sqlite-bun"
import { defineContract } from "@rafflink/core/test/contract"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { openDatabase } from "../src/database.ts"
import { accountsFileName, startServer } from "../src/start-server.ts"
import { tempDir } from "./fixtures.ts"

let info: ReturnType<typeof spyOn>

beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  info.mockRestore()
})

defineContract("bun", async (env) => {
  const dir = tempDir()
  const config = resolveConfig({ ...env, DATA_DIR: dir.path, PORT: "0" })
  const server = await startServer({ config, staticDir: null, devSpa: null })

  // A second connection to the accounts file, so the job runs on demand beside the server's own timer.
  const accountsDb = openDatabase(join(dir.path, accountsFileName))
  accountsDb.exec("PRAGMA busy_timeout = 2000")
  const tokenDeps: StreamerTokenDeps = {
    clock: systemClock,
    random: systemRandom,
    twitch: new TwitchClient(config, fetch),
    accounts: new AccountStore(new BunSqliteAsyncSql(accountsDb), config),
    keyRing: await openKeyRing(config.tokenSealKeys),
  }

  return {
    url: server.url,
    stop: async () => {
      await server.stop()
      accountsDb.close()
      dir.remove()
    },
    runValidateJob: async () => {
      await validateStreamerTokens(tokenDeps)
    },
  }
})
