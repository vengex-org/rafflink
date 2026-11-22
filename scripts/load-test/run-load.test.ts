import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  createFakeTwitch,
  profileImageUrlOf,
  websocket,
  type FakeTwitch,
} from "../../packages/fake-twitch/src/index.ts"
import { startServer, type RunningServer } from "../../apps/server/src/start-server.ts"
import { tempDir, testConfig } from "../../apps/server/test/fixtures.ts"
import { NonLocalUrlError } from "./local-host.ts"
import type { LoadPlan } from "./options.ts"
import { runLoad, type LoadTarget } from "./run-load.ts"

const streamerId = "200"
const firstViewerId = 100_000
const viewerCount = 60
const plan: LoadPlan = { rate: 30, durationSeconds: 2, duplicatePercent: 10 }

let dir: ReturnType<typeof tempDir>
let twitchServer: ReturnType<typeof serveFake>
let running: RunningServer | null
let info: ReturnType<typeof spyOn>

beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {})
  dir = tempDir()
  twitchServer = serveFake(fakeTwitch({}))
  running = null
})

afterEach(async () => {
  await running?.stop()
  await twitchServer.stop(true)
  dir.remove()
  info.mockRestore()
})

describe("runLoad", () => {
  it("enters every viewer once, repeats included, and finds the room consistent", async () => {
    const load = await launch()

    const report = await runLoad(load, plan)

    expect(report.failures).toEqual([])
    expect(report.viewers).toBe(viewerCount)
    expect(report.entrantCount).toBe(viewerCount)
    expect(report.callbackOutcomes).toEqual({ entered: viewerCount, "already-in": 6 })
    expect(report.repeatAttempts).toBe(6)
    expect(report.duplicateLogins).toBe(0)
    expect(report.enteredTwice).toBe(0)
    expect(report.queued.count).toBe(0)
  })

  it("follows queued viewers to their final outcome when the token endpoint answers 429", async () => {
    await twitchServer.stop(true)
    twitchServer = serveFake(fakeTwitch({ tokenLimitPerSecond: 5 }))
    const load = await launch({
      QUEUE_POLL_SECONDS: "1",
      QUEUE_COOLDOWN_SECONDS: "1",
      QUEUE_MAX_RATE_PER_SECOND: "100",
    })

    const report = await runLoad(load, { ...plan, duplicatePercent: 0 })

    expect(report.callbackOutcomes["pending"]).toBeGreaterThan(0)
    expect(report.queued.count).toBe(report.callbackOutcomes["pending"] ?? 0)
    expect(report.finalOutcomes).toEqual({ entered: viewerCount })
    expect(report.entrantCount).toBe(viewerCount)
    expect(report.failures).toEqual([])
  }, 30_000)

  it("reports viewers the fake Twitch cannot sign in as a failed run", async () => {
    const load = await launch()

    const report = await runLoad(
      { ...load, firstViewerId: firstViewerId + viewerCount },
      { rate: 5, durationSeconds: 1, duplicatePercent: 0 },
    )

    expect(report.failures.join("\n")).toContain("viewers did not end entered")
    expect(report.finalOutcomes).toEqual({ "http-400": 5 })
    expect(report.entrantCount).toBe(0)
  })

  it("stops before any request when the sign-in redirects to a host that is not local", async () => {
    const load = await launch({ TWITCH_ID_BASE_URL: "http://example.invalid" })

    await expect(runLoad(load, plan)).rejects.toThrow(NonLocalUrlError)
  })

  it("stops before any request when the callback redirects to a host that is not local", async () => {
    const load = await launch({ PUBLIC_URL: "http://example.invalid" })

    await expect(runLoad(load, plan)).rejects.toThrow(NonLocalUrlError)
  })

  it("stops starting viewers at the first one redirected to a host that is not local", async () => {
    let backend: URL | null = null
    let viewerStarts = 0
    const front = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname === "/auth/twitch/viewer/start") {
          viewerStarts += 1
          return Response.redirect("http://example.invalid/oauth2/authorize")
        }
        if (backend === null) return new Response(null, { status: 503 })
        return fetch(new URL(url.pathname + url.search, backend), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "manual",
        })
      },
    })
    try {
      const load = await launch({ PUBLIC_URL: front.url.origin })
      backend = load.target
      await expect(runLoad({ ...load, target: front.url }, plan)).rejects.toThrow(NonLocalUrlError)
    } finally {
      await front.stop(true)
    }

    expect(viewerStarts).toBeGreaterThan(0)
    expect(viewerStarts).toBeLessThan(viewerCount)
  })
})

function fakeTwitch(limits: { tokenLimitPerSecond?: number }): FakeTwitch {
  const created = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: {
      id: streamerId,
      login: "streamer",
      displayName: "Streamer",
      createdAt: "2019-01-01T00:00:00Z",
      profileImageUrl: profileImageUrlOf("streamer"),
    },
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
    ...limits,
  })
  created.control.seedUsers(viewerCount, firstViewerId)
  return created
}

function serveFake(fake: FakeTwitch) {
  return Bun.serve({ port: 0, fetch: fake.app.fetch, websocket })
}

async function launch(env: Readonly<Record<string, string>> = {}): Promise<LoadTarget> {
  const origin = twitchServer.url.origin
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop(true)
  running = await startServer({
    config: testConfig({
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      ENTRY_IP_LIMIT_PER_MINUTE: "1000",
      DATA_DIR: dir.path,
      TWITCH_ID_BASE_URL: origin,
      TWITCH_HELIX_BASE_URL: origin,
      ...env,
    }),
    staticDir: null,
    devSpa: null,
    devPublicDir: null,
  })
  return { target: running.url, streamerUserId: streamerId, firstViewerId }
}
