import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { seededUsersFirstId } from "../../packages/fake-twitch/src/index.ts"
import { assertLocalUrl } from "./local-host.ts"
import type { LoadTarget } from "./run-load.ts"

export interface SpawnedTargets {
  readonly load: LoadTarget
  stop(): Promise<void>
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const portRange = { first: 20_000, last: 39_999 }
const portAttempts = 20
const readyAttempts = 100
const readyPollMs = 100
/** A child that ignores the first kill is killed hard after this long; a starting guess, a healthy one exits in milliseconds. */
const stopTimeoutMs = 5_000

/** Credentials the fake accepts; the dev fake's own client id and secret. */
const twitchClient = { id: "fake-client-id", secret: "fake-client-secret" } as const

/**
 * Starts the fake Twitch and the Bun server as two child processes on free local ports, with a throwaway data
 * folder. The load generator, the server and the fake each get a process of their own, so none of them
 * starves the other for CPU. `QUEUE_*` and other server tunables set in this process's environment reach the server.
 */
export async function spawnTargets(
  streamerUserId: string,
  viewers: number,
  tokenLimitPerSecond: number | null,
): Promise<SpawnedTargets> {
  const dataDir = mkdtempSync(join(tmpdir(), "rafflink-load-test-"))
  const children: Bun.Subprocess[] = []
  const stop = async () => {
    for (const child of children) child.kill()
    const exited = Promise.all(children.map((child) => child.exited))
    const timedOut = await Promise.race([exited.then(() => false), sleep(stopTimeoutMs, true)])
    if (timedOut) {
      for (const child of children) child.kill("SIGKILL")
      await exited
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
  try {
    const twitchPort = await freePort()
    const serverPort = await freePort()
    const twitchUrl = `http://127.0.0.1:${twitchPort}`
    const serverUrl = `http://127.0.0.1:${serverPort}`
    children.push(
      Bun.spawn([process.execPath, "packages/fake-twitch/src/main.ts"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: String(twitchPort),
          SEED_USERS: String(viewers),
          ...(tokenLimitPerSecond === null
            ? {}
            : { TOKEN_LIMIT_PER_SECOND: String(tokenLimitPerSecond) }),
        },
        stdout: "ignore",
        stderr: "inherit",
      }),
    )
    await waitUntilAnswering(`${twitchUrl}/oauth2/keys`, children)
    children.push(
      Bun.spawn([process.execPath, "apps/server/src/main.ts"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: String(serverPort),
          PUBLIC_URL: serverUrl,
          DATA_DIR: dataDir,
          // Every viewer signs in from this machine's one address, and a repeat sign-in is a second callback.
          ENTRY_IP_LIMIT_PER_MINUTE: String(viewers * 2),
          TWITCH_ID_BASE_URL: twitchUrl,
          TWITCH_HELIX_BASE_URL: twitchUrl,
          EVENTSUB_URL: `ws://127.0.0.1:${twitchPort}/eventsub/ws`,
          TWITCH_CLIENT_ID: twitchClient.id,
          TWITCH_CLIENT_SECRET: twitchClient.secret,
          ADMIN_TWITCH_IDS: streamerUserId,
          SESSION_SECRET: "load-test-session-secret",
          TOKEN_SEAL_KEYS: "load:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
        stdout: "ignore",
        stderr: "inherit",
      }),
    )
    await waitUntilAnswering(`${serverUrl}/api/session`, children)
    return {
      load: {
        target: assertLocalUrl(serverUrl),
        streamerUserId,
        firstViewerId: seededUsersFirstId,
      },
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}

/** A port from {@link portRange} nothing listens on; the OS hands out client ports above it, which the load itself would use up. */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < portAttempts; attempt++) {
    const port = portRange.first + Math.floor(Math.random() * (portRange.last - portRange.first))
    try {
      const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response() })
      await probe.stop(true)
      return port
    } catch {
      // Taken; the next attempt picks another.
    }
  }
  throw new Error(`no free port in ${portRange.first}-${portRange.last}`)
}

async function waitUntilAnswering(url: string, children: readonly Bun.Subprocess[]): Promise<void> {
  assertLocalUrl(url)
  for (let attempt = 0; attempt < readyAttempts; attempt++) {
    if (children.some((child) => child.exitCode !== null)) {
      throw new Error("a child process exited before it answered; its error is above")
    }
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet; the next attempt asks again.
    }
    await sleep(readyPollMs)
  }
  throw new Error(`${url} did not answer within ${(readyAttempts * readyPollMs) / 1000} s`)
}
