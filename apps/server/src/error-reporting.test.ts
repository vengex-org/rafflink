import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { join } from "node:path"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import {
  FakeBeacon,
  idleChat,
  kickClientCredentials,
  startFakeKick,
  startFakeSentry,
  type FakeSentry,
  type RunningFakeKick,
} from "@rafflink/core/test/contract"
import { TwitchRateLimited } from "@rafflink/core/twitch/errors"
import { captureException, close, flush, getClient, getCurrentScope } from "@sentry/core"
import { giveawayInit, tempDir, testConfig } from "../test/fixtures.ts"
import { openDatabase } from "./database.ts"
import { startErrorReporting } from "./error-reporting.ts"
import { LocalRoomDirectory } from "./local-room-directory.ts"
import { accountsFileName, startServer, type RunningServer } from "./start-server.ts"

const giveawayId = "0123456789abcdef0123456789abcdef"
const reported = { SENTRY_ENVIRONMENT: "test", SENTRY_RELEASE: "test-release" }

let dir: ReturnType<typeof tempDir>
let sentry: FakeSentry
let kick: RunningFakeKick
let server: RunningServer | null
let logs: ReturnType<typeof spyOn>[]

beforeEach(async () => {
  dir = tempDir()
  sentry = await startFakeSentry()
  kick = startFakeKick()
  server = null
  logs = [
    spyOn(console, "info").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "error").mockImplementation(() => {}),
  ]
})

afterEach(async () => {
  await server?.stop()
  // The SDK is global to the process; the next test starts its own or none.
  await close()
  getCurrentScope().setClient(undefined)
  await sentry.stop()
  await kick.stop()
  dir.remove()
  for (const log of logs) log.mockRestore()
})

// @sentry/bun registers process handlers that `close` does not remove; the other test files must not inherit them.
const processEvents = ["uncaughtException", "unhandledRejection"] as const
const handlersBefore = processEvents.map((event) => new Set(process.listeners(event)))

afterAll(() => {
  processEvents.forEach((event, at) => {
    for (const handler of process.listeners(event)) {
      if (!handlersBefore[at]?.has(handler)) process.off(event, handler)
    }
  })
})

function configFor(env: Readonly<Record<string, string>>) {
  return testConfig({
    DATA_DIR: dir.path,
    KICK_CLIENT_ID: kickClientCredentials.id,
    KICK_CLIENT_SECRET: kickClientCredentials.secret,
    KICK_ID_BASE_URL: kick.origin,
    KICK_API_BASE_URL: kick.origin,
    ...env,
  })
}

async function launch(env: Readonly<Record<string, string>>): Promise<RunningServer> {
  const config = configFor(env)
  await startErrorReporting(config)
  server = await startServer({ config, staticDir: null, devSpa: null, devPublicDir: null })
  return server
}

// The accounts table goes away under the running server, so the next giveaway lookup throws.
function breakGiveawayLookups(): void {
  const db = openDatabase(join(dir.path, accountsFileName))
  db.exec("DROP TABLE giveaways")
  db.close()
}

describe("error reporting of the Bun server", () => {
  it("starts no SDK without a DSN, so a failing request sends nothing", async () => {
    const running = await launch({})
    breakGiveawayLookups()

    const response = await fetch(new URL("/api/g/ABCDE", running.url))
    await flush(500)

    expect(response.status).toBe(500)
    expect(getClient()).toBeUndefined()
    expect(sentry.requests()).toBe(0)
  })

  it("reports a request that failed with the release, the environment and the request id, without its cookie", async () => {
    const running = await launch({ SENTRY_DSN: sentry.dsn, ...reported })
    breakGiveawayLookups()

    const response = await fetch(new URL("/api/g/ABCDE?code=oauth-code", running.url), {
      headers: { cookie: "rafflink_session=secret-cookie" },
    })
    const { requestId }: { requestId: string } = await response.json()
    await sentry.eventsArrived(1)

    expect(response.status).toBe(500)
    expect(sentry.events).toEqual([
      expect.objectContaining({
        release: "test-release",
        environment: "test",
        tags: expect.objectContaining({ requestId }),
        exception: { values: [expect.objectContaining({ type: "SQLiteError" })] },
      }),
    ])
    expect(JSON.stringify(sentry.events)).not.toContain("secret-cookie")
    expect(JSON.stringify(sentry.events)).not.toContain("oauth-code")
  })

  it("sends nothing for an expired session, a forged Kick webhook or a Twitch 429 the caller retries", async () => {
    const running = await launch({
      SENTRY_DSN: sentry.dsn,
      KICK_PUBLIC_KEY_REFRESH_SECONDS: "1",
      ...reported,
    })
    const forgedWebhook = () =>
      fetch(new URL("/api/kick/webhook", running.url), {
        method: "POST",
        headers: {
          "kick-event-message-id": "m-1",
          "kick-event-subscription-id": "s-1",
          "kick-event-message-timestamp": new Date().toISOString(),
          "kick-event-signature": btoa("forged"),
          "kick-event-type": "chat.message.sent",
          "kick-event-version": "1",
        },
        body: "{}",
      })

    const expired = await fetch(new URL("/api/dash/giveaways", running.url), {
      headers: { cookie: "rafflink_session=expired" },
    })
    // The first refusal reads Kick's key and asks Kick to send again; past the refresh time the signature is rejected.
    const keyPending = await forgedWebhook()
    await Bun.sleep(1100)
    const rejected = await forgedWebhook()
    captureException(new TwitchRateLimited("token"))
    // A real failure after them: once its event arrived, an event of the requests before it would have too.
    breakGiveawayLookups()
    await fetch(new URL("/api/g/ABCDE", running.url))
    await sentry.eventsArrived(1)
    await flush(500)

    expect([expired.status, keyPending.status, rejected.status]).toEqual([401, 503, 401])
    expect(sentry.events).toEqual([
      expect.objectContaining({
        exception: { values: [expect.objectContaining({ type: "SQLiteError" })] },
      }),
    ])
  })

  it("reports a room alarm that failed", async () => {
    await startErrorReporting(configFor({ SENTRY_DSN: sentry.dsn, ...reported }))
    const config = testConfig({ LIVE_INTERVAL_MS: "1" })
    const rooms = new LocalRoomDirectory({
      roomsDir: join(dir.path, "rooms"),
      config,
      clock: systemClock,
      random: systemRandom,
      beacon: new FakeBeacon(),
      publish: () => {},
      subscriberCount: () => 0,
      onAlarm: async () => {
        throw new RangeError("alarm broke")
      },
      chat: () => idleChat(systemClock, config),
    })

    await rooms.get(giveawayId).init(giveawayInit(giveawayId))
    await sentry.eventsArrived(1)
    await rooms.close()

    expect(sentry.events[0]).toMatchObject({
      release: "test-release",
      environment: "test",
      exception: { values: [{ type: "RangeError" }] },
    })
    // A server error's message can quote a login or a platform id, so it stays out of the report.
    expect(sentry.events[0]).not.toHaveProperty(["exception", "values", 0, "value"])
  })
})
