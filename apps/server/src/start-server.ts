import { websocket } from "@hono/bun"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import type { StreamerTokenDeps } from "@rafflink/core/accounts/streamer-token"
import { validateStreamerTokens } from "@rafflink/core/accounts/validate-streamer-tokens"
import { AdminDirectory } from "@rafflink/core/admin/admin-directory"
import type { ResolvedConfig } from "@rafflink/core/config"
import {
  apiPrefixes,
  fakeKickPrefixes,
  fakeTwitchPrefixes,
  fakeYouTubePrefixes,
} from "@rafflink/core/http/api-paths"
import { DrandBeacon } from "@rafflink/core/beacon/drand-beacon"
import { createApp, type AppDeps, type WebFileLoader } from "@rafflink/core/http/create-app"
import { errorClass } from "@rafflink/core/lib/error-class"
import { captureException } from "@sentry/core"
import type { ReportError } from "@rafflink/core/ports"
import { MemoryPublicCache } from "@rafflink/core/lib/memory-public-cache"
import { MemoryRateLimiter } from "@rafflink/core/lib/memory-rate-limiter"
import { MemorySitePresence } from "@rafflink/core/lib/memory-site-presence"
import { openKeyRing } from "@rafflink/core/lib/seal"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { deleteExpiredGiveaways } from "@rafflink/core/room/delete-giveaway"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { runRoomAlarm, type RoomAlarmDeps } from "@rafflink/core/room/run-room-alarm"
import { StatsStore } from "@rafflink/core/stats/stats-store"
import { roomChat } from "@rafflink/core/room/room-chat"
import { queueMigrations } from "@rafflink/core/queue/migrations"
import { TokenQueue, type TokenQueueStub } from "@rafflink/core/queue/token-queue"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { TwitchProvider } from "@rafflink/core/twitch/twitch-provider"
import { kickAppOf, type KickApp } from "@rafflink/core/kick/kick-client"
import { kickPlatform } from "@rafflink/core/kick/kick-provider"
import { youtubeAppOf, type YouTubeApp } from "@rafflink/core/youtube/youtube-client"
import { youtubePlatform } from "@rafflink/core/youtube/youtube-provider"
import { enterQueuedCode } from "@rafflink/core/viewer/enter-giveaway"
import type { Hono } from "hono"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { BunSocketConnector } from "./bun-socket-connector.ts"
import { clientAddress } from "./client-address.ts"
import { openDatabase } from "./database.ts"
import { LocalRoomDirectory } from "./local-room-directory.ts"
import { applyAccountsMigrations, coreAccountsSchemaDir } from "./migrate.ts"
import { createServerApp } from "./server-app.ts"
import { skipWhileRunning } from "./skip-while-running.ts"
import { TimerAlarm } from "./timer-alarm.ts"

export interface ServerOptions {
  readonly config: ResolvedConfig
  /** The built SPA; null serves no files. */
  readonly staticDir: string | null
  /** The SPA entry served with hot reload; set only together with `config.devFakeTwitch`. */
  readonly devSpa: Bun.HTMLBundle | null
  /** The web app's `public/` folder, answered ahead of the dev SPA; null serves none. */
  readonly devPublicDir: string | null
}

export interface RunningServer {
  readonly url: URL
  stop(): Promise<void>
}

export const accountsFileName = "accounts.sqlite"
const queueFileName = "queue.sqlite"
const roomsDirName = "rooms"
// The entry limits are per minute.
const rateWindowMs = 60_000
// Hourly, like the Cloudflare cron of wrangler.jsonc that runs the same sweep.
const historySweepMs = 3_600_000

// Tags, not extra data: a request id or a giveaway id is what an issue is searched by.
const reportError: ReportError = (error, context) => {
  captureException(error, { tags: context })
}

/**
 * Opens the data folder, starts the timers and listens. With `config.devFakeTwitch` the fake Twitch answers at the
 * Twitch URLs, with `config.devFakeKick` the fake Kick at the Kick URLs, with `config.devFakeYouTube` the fake YouTube at
 * the Google URLs.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { config, staticDir, devSpa, devPublicDir } = options
  const clock = systemClock
  const random = systemRandom
  mkdirSync(config.dataDir, { recursive: true })

  const accountsDb = openDatabase(join(config.dataDir, accountsFileName))
  const applied = applyAccountsMigrations(accountsDb, coreAccountsSchemaDir(), clock)
  if (applied.length > 0) console.info("accounts migrations applied", { count: applied.length })
  const accountsSql = new BunSqliteAsyncSql(accountsDb)
  const accounts = new AccountStore(accountsSql, config)
  const stats = new StatsStore(accountsSql, config)
  const twitch = new TwitchClient(config, fetch)
  const keyRing = await openKeyRing(config.tokenSealKeys)
  const youtube = youtubePlatform(config, fetch, clock, accountsSql)
  const platforms = {
    twitch: new TwitchProvider(twitch, clock, config),
    ...kickPlatform(config, fetch, clock, accountsSql),
    ...youtube,
  }
  const tokenDeps: StreamerTokenDeps = { clock, random, platforms, accounts, keyRing }
  const connector = new BunSocketConnector()
  const alarmDeps: RoomAlarmDeps = { ...tokenDeps, stats }

  const rooms = new LocalRoomDirectory({
    roomsDir: join(config.dataDir, roomsDirName),
    config,
    clock,
    random,
    beacon: new DrandBeacon(config, fetch, random),
    publish: (topic, message) => void server.publish(topic, message),
    subscriberCount: (topic) => server.subscriberCount(topic),
    onAlarm: (giveawayId, room) => runRoomAlarm(alarmDeps, giveawayId, room),
    chat: (giveawayId) => roomChat(tokenDeps, connector, giveawayId),
  })

  const queueDb = openDatabase(join(config.dataDir, queueFileName))
  const queueSql = new BunSqliteSyncSql(queueDb)
  applyMigrations(queueSql, queueMigrations)
  const entryDeps = {
    config,
    clock,
    random,
    platforms,
    accounts,
    rooms,
    entryUserLimiter: new MemoryRateLimiter(clock, config.entryUserLimitPerMinute, rateWindowMs),
  }
  // The timer can fire while a pass still waits for Twitch; the claim in the queue keeps rows apart, this keeps passes apart.
  const runQueue = skipWhileRunning(async () => {
    try {
      await queue.onAlarm()
    } catch (error) {
      captureException(error)
      console.error("token queue alarm failed", { errorClass: errorClass(error) })
    }
  })
  const queueAlarm = new TimerAlarm(clock, () => void runQueue())
  const queue = new TokenQueue({
    sql: queueSql,
    alarm: queueAlarm,
    clock,
    random,
    config,
    process: (item) => enterQueuedCode(entryDeps, item),
    rooms,
    // Bun caps no subrequests: one invocation runs the whole pass.
    entriesPerInvocation: config.queueMaxRatePerSecond,
    reportError,
  })
  const presence = new MemorySitePresence()
  const deps: AppDeps = {
    ...entryDeps,
    queue: remoteQueue(queue),
    stats,
    usage: { today: async () => null },
    visits: { lastDays: async () => null },
    planQueue: null,
    youtubeQuota: youtube.youtube?.quota ?? null,
    publicCache: new MemoryPublicCache(clock, config.publicCacheMaxEntries),
    keyRing,
    admins: new AdminDirectory(config, twitch),
    entryIpLimiter: new MemoryRateLimiter(clock, config.entryIpLimitPerMinute, rateWindowMs),
    leavesIpLimiter: new MemoryRateLimiter(clock, config.leavesIpLimitPerMinute, rateWindowMs),
    moderatorIpLimiter: new MemoryRateLimiter(
      clock,
      config.moderatorIpLimitPerMinute,
      rateWindowMs,
    ),
    clientAddress: (request) => clientAddress(request, server, config.clientIpHeader),
    reportError,
    presence,
    presenceIpLimiter: new MemoryRateLimiter(clock, config.presenceIpLimitPerMinute, rateWindowMs),
  }

  const fakeTwitch = config.devFakeTwitch ? await createFakeTwitchApp(config) : null
  const kickApp = kickAppOf(config)
  // resolveConfig refuses DEV_FAKE_KICK without a Kick app, so the fake never runs without one.
  const fakeKick =
    config.devFakeKick && kickApp !== null ? await createFakeKickApp(kickApp, config) : null
  const youtubeApp = youtubeAppOf(config)
  // resolveConfig refuses DEV_FAKE_YOUTUBE without a Google client as well.
  const fakeYouTube =
    config.devFakeYouTube && youtubeApp !== null ? await createFakeYouTubeApp(youtubeApp) : null
  const app = createServerApp({
    api: createApp(deps, staticDir === null ? null : webFilesOf(staticDir)),
    rooms,
    presence,
    fakeTwitch,
    fakeKick,
    fakeYouTube,
    staticDir: staticDir ?? devPublicDir,
  })
  const server = Bun.serve({
    port: config.port,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
    ...(devSpa === null
      ? {}
      : {
          routes: devRoutes(app, devSpa, devPublicDir),
          development: { hmr: true, console: true },
        }),
  })

  const validateTimer = setInterval(() => void runValidation(), config.validatePeriodSeconds * 1000)
  void runValidation()
  const historyDays = config.historyRetentionDays
  const historyTimer =
    historyDays === null
      ? null
      : setInterval(() => void runHistoryRetention(historyDays), historySweepMs)
  void runQueue()
  await rooms.reviveAll()

  return {
    url: server.url,
    stop: async () => {
      clearInterval(validateTimer)
      if (historyTimer !== null) clearInterval(historyTimer)
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
      captureException(error)
      console.error("streamer token validation failed", { errorClass: errorClass(error) })
    }
  }

  async function runHistoryRetention(days: number): Promise<void> {
    try {
      const deleted = await deleteExpiredGiveaways({ accounts, rooms, clock, config }, days)
      console.info("history retention sweep", { deleted })
    } catch (error) {
      captureException(error)
      console.error("history retention sweep failed", { errorClass: errorClass(error) })
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

// The names come from core and the build's own manifest, never from a request.
function webFilesOf(staticDir: string): WebFileLoader {
  return async (file) => {
    const found = Bun.file(join(staticDir, file))
    return (await found.exists()) ? found.text() : null
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

// Loaded here for the same reason as the fake Twitch. Its webhooks go to this server, as the Kick app's settings would say.
async function createFakeKickApp(kickApp: KickApp, config: ResolvedConfig): Promise<Hono> {
  const { createFakeKick, devFakeKickOptions, devFakeKickUsers } =
    await import("@rafflink/fake-kick")
  const fake = createFakeKick({ ...devFakeKickOptions, ...kickApp })
  for (const user of devFakeKickUsers) fake.control.addUser(user)
  fake.control.setWebhookUrl(new URL("/api/kick/webhook", config.publicUrl).href)
  return fake.app
}

// Loaded here for the same reason as the fake Twitch.
async function createFakeYouTubeApp(youtubeApp: YouTubeApp): Promise<Hono> {
  const { createFakeYouTube, devFakeYouTubeOptions, startDevFakeYouTube } =
    await import("@rafflink/fake-youtube")
  const fake = createFakeYouTube({ ...devFakeYouTubeOptions, ...youtubeApp })
  startDevFakeYouTube(fake)
  return fake.app
}

// A wildcard route for the SPA would swallow every path, so each path the server answers is listed.
// The folder is read once at start: a file added to it later needs a restart.
function devRoutes(app: Hono, spa: Bun.HTMLBundle, publicDir: string | null) {
  const answered = (request: Request, bunServer: Bun.Server<unknown>) =>
    app.fetch(request, bunServer)
  const publicPaths =
    publicDir === null || !existsSync(publicDir)
      ? []
      : readdirSync(publicDir, { withFileTypes: true }).map((entry) =>
          entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`,
        )
  const handled = [
    ...[...apiPrefixes, ...fakeTwitchPrefixes, ...fakeKickPrefixes, ...fakeYouTubePrefixes].map(
      (prefix) => `${prefix}*`,
    ),
    ...publicPaths,
  ]
  return { ...Object.fromEntries(handled.map((path) => [path, answered])), "/*": spa }
}
