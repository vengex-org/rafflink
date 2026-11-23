import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GiveawayInit } from "@rafflink/core/room/giveaway-room"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import { startFakeSentry, type FakeSentry } from "@rafflink/core/test/contract"
import type { Miniflare } from "miniflare"
import { startMiniflare } from "./start-worker.ts"

const env = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  // Key id, then 32 zero bytes in base64.
  TOKEN_SEAL_KEYS: "test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "http://localhost",
  SENTRY_ENVIRONMENT: "test",
  SENTRY_RELEASE: "test-release",
}

/** The RPC method of the room object this test calls. */
interface RoomBinding {
  newUniqueId(): unknown
  get(id: unknown): { init(giveaway: GiveawayInit): Promise<unknown> }
}

const rules: GiveawayRules = {
  tickets: {
    viewer: 1,
    follower: 1,
    sub_t1: 1,
    sub_t2: 1,
    sub_t3: 1,
    member: 0,
    // VIP tickets make the room arm its role refresh at once, so the alarm runs right after init.
    vip: 2,
    moderator: 1,
  },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
  excludeRecentWinners: null,
  chatKeyword: null,
  pageEntry: true,
  subEntry: false,
  pointsReward: null,
  minAge: null,
  excludedCountries: null,
  extraTerms: null,
  winnerForm: [],
}

let sentry: FakeSentry
// Without an `index.html` the Worker's page routes throw: the route failure the tests report.
let emptyWebDir: string
let miniflare: Miniflare | null

beforeEach(async () => {
  sentry = await startFakeSentry()
  emptyWebDir = mkdtempSync(join(tmpdir(), "rafflink-web-"))
  miniflare = null
})

afterEach(async () => {
  await miniflare?.dispose()
  await sentry.stop()
  rmSync(emptyWebDir, { recursive: true, force: true })
})

async function start(extra: Record<string, string>) {
  const started = await startMiniflare({ ...env, ...extra }, emptyWebDir)
  miniflare = started.miniflare
  return started
}

describe("error reporting of the Worker", () => {
  it("sends nothing without a DSN", async () => {
    const { url } = await start({})

    const response = await fetch(new URL("/privacy", url))
    await Bun.sleep(500)

    expect(response.status).toBe(500)
    expect(sentry.requests()).toBe(0)
  })

  it("reports a route that failed with the release, the environment and the request id", async () => {
    const { url } = await start({ SENTRY_DSN: sentry.dsn })

    const response = await fetch(new URL("/privacy?code=oauth-code&state=oauth-state", url), {
      headers: { cookie: "rafflink_session=secret-cookie" },
    })
    const { requestId }: { requestId: string } = await response.json()
    await sentry.eventsArrived(1)

    expect(sentry.events[0]).toMatchObject({
      release: "test-release",
      environment: "test",
      tags: { requestId },
      exception: { values: [{ type: "Error" }] },
    })
    for (const secret of ["secret-cookie", "oauth-code", "oauth-state", "no index.html"]) {
      expect(JSON.stringify(sentry.events)).not.toContain(secret)
    }
  })

  it("reports a room alarm that failed", async () => {
    const started = await start({ SENTRY_DSN: sentry.dsn })
    const { ROOMS } = await started.miniflare.getBindings<{ ROOMS: RoomBinding }>()
    // An object addressed by a unique id has no name, so its alarm throws when it reads the giveaway id.
    const room = ROOMS.get(ROOMS.newUniqueId())

    await room.init({
      id: "0123456789abcdef0123456789abcdef",
      platform: "twitch",
      broadcasterId: "200",
      title: "Giveaway",
      code: "ABCDE",
      rules,
      winnerCount: 1,
      claimSeconds: 300,
      closesAt: null,
    })
    await sentry.eventsArrived(1)

    expect(sentry.events[0]).toMatchObject({
      release: "test-release",
      environment: "test",
      exception: {
        values: [{ type: "TypeError" }],
      },
    })
  })
})
