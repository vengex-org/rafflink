import { websocket } from "@hono/bun"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { AdminDirectory } from "@rafflink/core/admin/admin-directory"
import type { ResolvedConfig } from "@rafflink/core/config"
import { createApp, type AppDeps } from "@rafflink/core/http/create-app"
import { openKeyRing } from "@rafflink/core/lib/seal"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { runRoomAlarm } from "@rafflink/core/room/run-room-alarm"
import { subscribeChat } from "@rafflink/core/room/subscribe-chat"
import { queueMigrations } from "@rafflink/core/queue/migrations"
import { TokenQueue, type TokenQueueStub } from "@rafflink/core/queue/token-queue"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { enterQueuedCode } from "@rafflink/core/viewer/enter-giveaway"
import type { Hono } from "hono"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { BunSocketConnector } from "./bun-socket-connector.ts"
import { openDatabase } from "./database.ts"
import { LocalRoomDirectory } from "./local-room-directory.ts"
import { applyAccountsMigrations, coreAccountsSchemaDir } from "./migrate.ts"
import { apiPrefixes, createServerApp, fakeTwitchPrefixes } from "./server-app.ts"
import { TimerAlarm } from "./timer-alarm.ts"

export interface ServerOptions {
  readonly config: ResolvedConfig
  /** The built SPA; null serves no files. */
  readonly staticDir: string | null
  /** The SPA entry served with hot reload; set only together with `config.devFakeTwitch`. */
  readonly devSpa: Bun.HTMLBundle | null
}

export interface RunningServer {
  readonly url: URL
  stop(): Promise<void>
}

export const accountsFileName = "accounts.sqlite"
const queueFileName = "queue.sqlite"
const roomsDirName = "rooms"

/** Opens the data folder, starts the timers and listens. With `config.devFakeTwitch` the fake Twitch answers at the Twitch URLs. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { config, staticDir, devSpa } = options
  const clock = systemClock
  const random = systemRandom
  mkdirSync(config.dataDir, { recursive: true })

  const accountsDb = openDatabase(join(config.dataDir, accountsFileName))
  const applied = applyAccountsMigrations(accountsDb, coreAccountsSchemaDir(), clock)
  if (applied.length > 0) console.info("accounts migrations applied", { count: applied.length })
  const accounts = new AccountStore(new BunSqliteAsyncSql(accountsDb), config)
  const twitch = new TwitchClient(config, fetch)
  const keyRing = await openKeyRing(config.tokenSealKeys)
  const tokenDeps: StreamerTokenDeps = { clock, random, twitch, accounts, keyRing }

  const rooms = new LocalRoomDirectory({
    roomsDir: join(config.dataDir, roomsDirName),
    config,
    clock,
    random,
    publish: (topic, message) => void server.publish(topic, message),
    onAlarm: (giveawayId, room) => runRoomAlarm(tokenDeps, giveawayId, room),
    connector: new BunSocketConnector(),
    subscribeChat: (giveawayId, sessionId) => subscribeChat(tokenDeps, giveawayId, sessionId),
  })

  const queueDb = openDatabase(join(config.dataDir, queueFileName))
  const queueSql = new BunSqliteSyncSql(queueDb)
  applyMigrations(queueSql, queueMigrations)
  const entryDeps = { config, clock, random, twitch, accounts, rooms }
  const queueAlarm = new TimerAlarm(clock, () => void runQueue())
  const queue = new TokenQueue({
    sql: queueSql,
    alarm: queueAlarm,
    clock,
    random,
    config,
    process: (item) => enterQueuedCode(entryDeps, item),
  })
  const deps: AppDeps = {
    ...entryDeps,
    queue: remoteQueue(queue),
    usage: { today: async () => null },
    keyRing,
    admins: new AdminDirectory(config, twitch),
  }

  const fakeTwitch = config.devFakeTwitch ? await createFakeTwitchApp(config) : null
  const app = createServerApp({ api: createApp(deps), fakeTwitch, staticDir })
  const server = Bun.serve({
    port: config.port,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
    ...(devSpa === null
      ? {}
      : { routes: devRoutes(app, devSpa), development: { hmr: true, console: true } }),
  })

  const validateTimer = setInterval(() => void runValidation(), config.validatePeriodSeconds * 1000)
  void runValidation()
  void runQueue()
  await rooms.reviveAll()

  return {
    url: server.url,
    stop: async () => {
      clearInterval(validateTimer)
      queueAlarm.clear()
      await server.stop(true)
      await rooms.close()
      queueDb.close()
      accountsDb.close()
    },
  }

  async function runValidation(): Promise<void> {
    try {
      console.info("streamer token validation", await validateStreamerTokens(tokenDeps))
    } catch (error) {
      console.error("streamer token validation failed", { errorClass: errorClassOf(error) })
    }
  }

  async function runQueue(): Promise<void> {
    try {
      await queue.onAlarm()
    } catch (error) {
      console.error("token queue alarm failed", { errorClass: errorClassOf(error) })
    }
  }
}

function remoteQueue(queue: TokenQueue): TokenQueueStub {
  return {
    enqueue: async (item, cause) => queue.enqueue(item, cause),
    poll: async (ticket) => queue.poll(ticket),
    stats: async () => queue.stats(),
  }
}

// Loaded here, not at the top of the module, so a production server never reads the fake.
async function createFakeTwitchApp(config: ResolvedConfig): Promise<Hono> {
  const { createFakeTwitch, devFakeTwitchOptions, devFakeTwitchUsers } =
    await import("@rafflink/fake-twitch")
  const fake = createFakeTwitch({
    ...devFakeTwitchOptions,
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
  })
  for (const user of devFakeTwitchUsers) fake.control.addUser(user)
  return fake.app
}

// A wildcard route for the SPA would swallow every path, so each path the server answers is listed.
function devRoutes(app: Hono, spa: Bun.HTMLBundle) {
  const handled = [...apiPrefixes, ...fakeTwitchPrefixes].map((prefix) => `${prefix}*`)
  return {
    ...Object.fromEntries(
      handled.map((path) => [
        path,
        (request: Request, bunServer: Bun.Server<unknown>) => app.fetch(request, bunServer),
      ]),
    ),
    "/*": spa,
  }
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}
