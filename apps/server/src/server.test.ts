import type { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { AccountStore } from "@rafflink/core/accounts/account-store"
import { streamerFeatures } from "@rafflink/core/domain/streamer-features"
import type { ResolvedConfig } from "@rafflink/core/config"
import { openKeyRing, type KeyRing } from "@rafflink/core/lib/seal"
import { BunSqliteAsyncSql } from "@rafflink/core/sqlite-bun"
import { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import {
  Browser,
  openSocket,
  startFakeTwitch,
  users,
  waitFor,
  type RunningFakeTwitch,
} from "@rafflink/core/test/contract"
import { seedStreamer } from "../test/fake-twitch.ts"
import { sealKey, tempDir, testConfig, validRules } from "../test/fixtures.ts"
import { openDatabase } from "./database.ts"
import { accountsFileName, startServer, type RunningServer } from "./start-server.ts"

let dir: ReturnType<typeof tempDir>
let twitch: RunningFakeTwitch
let running: RunningServer[]
let databases: Database[]
let info: ReturnType<typeof spyOn>

beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {})
  dir = tempDir()
  twitch = startFakeTwitch()
  running = []
  databases = []
})

afterEach(async () => {
  for (const server of running) await server.stop()
  for (const db of databases) db.close()
  await twitch.stop()
  dir.remove()
  info.mockRestore()
})

function configFor(env: Readonly<Record<string, string>> = {}): ResolvedConfig {
  return testConfig({
    DATA_DIR: dir.path,
    TWITCH_ID_BASE_URL: twitch.origin,
    TWITCH_HELIX_BASE_URL: twitch.origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
    ENTRY_WRITE_RETRY_DELAYS_MS: "0",
    LIVE_INTERVAL_MS: "1",
    VALIDATE_PERIOD_SECONDS: "1",
    ...env,
  })
}

async function launch(
  env: Readonly<Record<string, string>> = {},
  staticDir: string | null = null,
): Promise<RunningServer> {
  const server = await startServer({
    config: configFor(env),
    staticDir,
    devSpa: null,
    devPublicDir: null,
  })
  running.push(server)
  return server
}

/** A second connection to the accounts file the server uses, for seeding and reading rows. */
async function accountsOf(env: Readonly<Record<string, string>> = {}) {
  const config = configFor(env)
  const db = openDatabase(join(dir.path, accountsFileName))
  db.exec("PRAGMA busy_timeout = 2000")
  databases.push(db)
  const accounts = new AccountStore(new BunSqliteAsyncSql(db), config)
  const keyRing: KeyRing = await openKeyRing([sealKey])
  return { db, accounts, keyRing, twitch: new TwitchClient(config, fetch) }
}

function tokenRows(db: Database): string[] {
  return db
    .query<{ streamer_id: string }, []>("SELECT streamer_id FROM streamer_tokens ORDER BY 1")
    .all()
    .map((row) => row.streamer_id)
}

/** The platforms the session offers, and the status of each Kick and YouTube sign-in start. */
async function signInOf(server: RunningServer) {
  const session = await fetch(new URL("/api/session", server.url))
  const paths = [
    "/auth/kick/streamer/start",
    "/auth/kick/viewer/start",
    "/auth/youtube/streamer/start",
  ]
  const starts = await Promise.all(
    paths.map(
      async (path) => (await fetch(new URL(path, server.url), { redirect: "manual" })).status,
    ),
  )
  return { platforms: (await session.json()).signInPlatforms, starts }
}

describe("hourly validate job", () => {
  it("hourly job deletes a token that validate rejects", async () => {
    await launch()
    const { db, accounts, keyRing, twitch: client } = await accountsOf()
    await seedStreamer(twitch, client, accounts, keyRing, "a", users.streamer.id)
    twitch.fake.control.revokeUserTokens(users.streamer.id)

    await waitFor(() => tokenRows(db).length === 0, 5000, "the job to delete the token")

    expect(db.query("SELECT id FROM streamers").all()).toEqual([{ id: "a" }])
  })

  it("a 5xx keeps the token", async () => {
    await launch()
    const { db, accounts, keyRing, twitch: client } = await accountsOf()
    await seedStreamer(twitch, client, accounts, keyRing, "a", users.streamer.id)
    const refreshesBefore = tokenCalls()
    twitch.fake.control.failNext("token", 503, 1)

    await waitFor(() => tokenCalls() > refreshesBefore, 5000, "the job to call Twitch")
    await sleep(100)

    expect(tokenRows(db)).toEqual(["a"])
  })

  it("one failing token does not stop the rest", async () => {
    await launch()
    const { db, accounts, keyRing, twitch: client } = await accountsOf()
    await seedStreamer(twitch, client, accounts, keyRing, "0", users.streamer.id)
    await accounts.replaceStreamerToken("0", "not-a-sealed-value", 2000)
    await seedStreamer(twitch, client, accounts, keyRing, "b", users.otherStreamer.id)
    twitch.fake.control.revokeUserTokens(users.otherStreamer.id)

    await waitFor(() => tokenRows(db).join() === "0", 5000, "the job to delete the second token")
  })
})

describe("routes", () => {
  it("fake Twitch routes answer 404 without DEV_FAKE_TWITCH", async () => {
    const dist = distWithIndex()
    const server = await launch({}, dist)

    for (const path of ["/oauth2/keys", "/oauth2/authorize", "/helix/users", "/eventsub/ws"]) {
      const response = await fetch(new URL(path, server.url))
      expect({ path, status: response.status }).toEqual({ path, status: 404 })
      expect(await response.json()).toEqual({ error: "not-found" })
    }
  })

  it("mounts the fake Twitch routes with DEV_FAKE_TWITCH", async () => {
    const server = await launch({ DEV_FAKE_TWITCH: "true" })

    const response = await fetch(new URL("/oauth2/keys", server.url))

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty("keys")
  })

  it("mounts the fake Kick routes only with DEV_FAKE_KICK", async () => {
    // The Kick URLs point at a closed local port, so nothing reaches the real Kick.
    const kickApp = {
      KICK_CLIENT_ID: "fake-kick-id",
      KICK_CLIENT_SECRET: "fake-kick-secret",
      KICK_ID_BASE_URL: "http://127.0.0.1:9",
      KICK_API_BASE_URL: "http://127.0.0.1:9",
    }
    const without = await launch(kickApp)
    const withFake = await launch({ ...kickApp, DEV_FAKE_KICK: "true" })

    const missing = await fetch(new URL("/public/v1/public-key", without.url))
    const mounted = await fetch(new URL("/public/v1/public-key", withFake.url))

    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "not-found" })
    expect(mounted.status).toBe(200)
  })

  it("mounts the fake YouTube routes only with DEV_FAKE_YOUTUBE", async () => {
    // The Google URLs point at a closed local port, so nothing reaches the real Google.
    const googleClient = {
      YOUTUBE_CLIENT_ID: "fake-youtube-id",
      YOUTUBE_CLIENT_SECRET: "fake-youtube-secret",
      YOUTUBE_AUTH_BASE_URL: "http://127.0.0.1:9",
      YOUTUBE_TOKEN_BASE_URL: "http://127.0.0.1:9",
      YOUTUBE_API_BASE_URL: "http://127.0.0.1:9",
    }
    const without = await launch(googleClient)
    const withFake = await launch({ ...googleClient, DEV_FAKE_YOUTUBE: "true" })

    const missing = await fetch(new URL("/tokeninfo?access_token=x", without.url))
    const mounted = await fetch(new URL("/tokeninfo?access_token=x", withFake.url))

    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "not-found" })
    expect([mounted.status, await mounted.json()]).toEqual([400, { error: "invalid_token" }])
  })

  it("drops the sign-in of platforms listed in SIGN_IN_DISABLED_PLATFORMS though their apps are set", async () => {
    // The Kick and Google URLs point at a closed local port, so nothing reaches the real platforms.
    const apps = {
      KICK_CLIENT_ID: "kick-id",
      KICK_CLIENT_SECRET: "kick-secret",
      KICK_ID_BASE_URL: "http://127.0.0.1:9",
      KICK_API_BASE_URL: "http://127.0.0.1:9",
      YOUTUBE_CLIENT_ID: "youtube-id",
      YOUTUBE_CLIENT_SECRET: "youtube-secret",
      YOUTUBE_AUTH_BASE_URL: "http://127.0.0.1:9",
      YOUTUBE_TOKEN_BASE_URL: "http://127.0.0.1:9",
      YOUTUBE_API_BASE_URL: "http://127.0.0.1:9",
    }
    const on = await launch(apps)
    const off = await launch({ ...apps, SIGN_IN_DISABLED_PLATFORMS: "kick,youtube" })
    expect((await signInOf(on)).platforms).toEqual(["twitch", "kick", "youtube"])
    expect(await signInOf(off)).toEqual({ platforms: ["twitch"], starts: [404, 404, 404] })
  })

  it("lets a dev sign-in pick the second fake user with login_hint", async () => {
    const server = await launch({ DEV_FAKE_TWITCH: "true" })
    const known = await fetch(
      new URL(`/oauth2/authorize?${devAuthorizeQuery("1001")}`, server.url),
      {
        redirect: "manual",
      },
    )
    const unknown = await fetch(
      new URL(`/oauth2/authorize?${devAuthorizeQuery("42")}`, server.url),
      {
        redirect: "manual",
      },
    )

    expect(known.status).toBe(302)
    expect(unknown.status).toBe(400)
  })

  it("answers an unknown giveaway code with a 404 JSON", async () => {
    const server = await launch()

    const response = await fetch(new URL("/api/g/XXXXX", server.url))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not-found" })
  })

  it("serves a built file by name and falls back to index.html for a page path", async () => {
    const server = await launch({}, distWithIndex())

    const file = await fetch(new URL("/app.js", server.url))
    const page = await fetch(new URL("/g/ABCDE", server.url))

    expect(await file.text()).toBe("console.info('app')")
    expect(page.status).toBe(200)
    expect(await page.text()).toBe("<!doctype html><title>Rafflink</title>")
  })

  it("caches a hashed bundle for a year and makes the page and other files revalidate", async () => {
    const server = await launch({}, distWithIndex())

    const bundle = await fetch(new URL("/index-abc123.js", server.url))
    const file = await fetch(new URL("/app.js", server.url))
    const home = await fetch(new URL("/", server.url))

    expect(bundle.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(file.headers.get("cache-control")).toBe("no-cache")
    expect(home.headers.get("cache-control")).toBe("no-cache")
    expect(await home.text()).toContain("<title>Rafflink</title>")
  })

  it("keeps an unknown API path a JSON 404 even when the SPA is served", async () => {
    const server = await launch({}, distWithIndex())

    const response = await fetch(new URL("/api/nothing", server.url))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not-found" })
  })

  it("serves no files when no static folder is set", async () => {
    const server = await launch()

    const response = await fetch(new URL("/", server.url))

    expect(response.status).toBe(404)
  })
})

async function callbackEntries(
  server: RunningServer,
  code: string,
  forwardedFor: readonly string[],
): Promise<(string | null)[]> {
  const entries: (string | null)[] = []
  for (const [index, address] of forwardedFor.entries()) {
    const response = await new Browser(server.url).signInAs(
      index === 0 ? users.viewer.id : users.viewer2.id,
      `/auth/twitch/viewer/start?giveaway=${code}`,
      twitch.fake.control,
      { "x-forwarded-for": address },
    )
    entries.push(
      new URL(response.headers.get("location") ?? "", "http://localhost").searchParams.get("entry"),
    )
  }
  return entries
}

describe("client address limit", () => {
  it("counts by the address of the connection when no header is configured, so a forged header does not help", async () => {
    const server = await launch({ ENTRY_IP_LIMIT_PER_MINUTE: "1" })
    const { code } = await createGiveaway(server)

    expect(await callbackEntries(server, code, ["203.0.113.1", "203.0.113.2"])).toEqual([
      "entered",
      "rate-limited",
    ])
  })

  it("counts by the configured header when one is set", async () => {
    const server = await launch({
      ENTRY_IP_LIMIT_PER_MINUTE: "1",
      CLIENT_IP_HEADER: "X-Forwarded-For",
    })
    const { code } = await createGiveaway(server)

    expect(await callbackEntries(server, code, ["203.0.113.1", "203.0.113.2"])).toEqual([
      "entered",
      "entered",
    ])
  })
})

describe("live pages", () => {
  it("a live WebSocket subscriber receives a snapshot after an entry", async () => {
    const server = await launch()
    const { id, code, overlayToken } = await createGiveaway(server)
    const { socket, messages } = openSocket(
      new URL(`/api/overlay/${id}/${overlayToken}`, server.url),
    )
    await waitFor(() => messages.length === 1, 5000, "the first snapshot")

    const viewer = new Browser(server.url)
    await viewer.signInAs(
      users.viewer.id,
      `/auth/twitch/viewer/start?giveaway=${code}`,
      twitch.fake.control,
    )
    await waitFor(() => messages.length >= 2, 5000, "the snapshot after the entry")
    socket.close()

    expect(entrantCounts(messages)).toEqual([0, 1])
  })

  it("lets the owner of a giveaway open its live socket and refuses a request without a session", async () => {
    const server = await launch()
    const { id, streamer } = await createGiveaway(server)
    const { socket, messages } = openSocket(new URL(`/api/live/${id}`, server.url), {
      cookie: streamer.cookieHeader(),
      origin: "http://localhost",
    })

    await waitFor(() => messages.length === 1, 5000, "the first snapshot")
    socket.close()

    expect(entrantCounts(messages)).toEqual([0])
    const anonymous = await fetch(new URL(`/api/live/${id}`, server.url), {
      headers: { ...upgrade, origin: "http://localhost" },
    })
    expect(anonymous.status).toBe(401)
  })

  it("overlay with a wrong token gets 404", async () => {
    const server = await launch()
    const { id, overlayToken } = await createGiveaway(server)
    const wrong = `${overlayToken.slice(0, -1)}${overlayToken.endsWith("0") ? "1" : "0"}`

    const plain = await fetch(new URL(`/api/overlay/${id}/${wrong}`, server.url))
    const socket = await fetch(new URL(`/api/overlay/${id}/${wrong}`, server.url), {
      headers: upgrade,
    })

    expect(plain.status).toBe(404)
    expect(socket.status).toBe(404)
  })

  it("alarm fires and closes a room at its end time", async () => {
    const server = await launch()
    const closesAt = new Date(Date.now() + 400).toISOString()
    const { id, code } = await createGiveaway(server, { closesAt })
    const { db } = await accountsOf()
    const status = async () =>
      (await (await fetch(new URL(`/api/g/${code}`, server.url))).json()).status

    expect(await status()).toBe("open")
    await waitFor(async () => (await status()) === "closed", 5000, "the room to close")

    await waitFor(
      () =>
        db.query<{ status: string }, [string]>("SELECT status FROM giveaways WHERE id = ?").get(id)
          ?.status === "closed",
      5000,
      "the status to reach the account store",
    )
  })
})

const upgrade = {
  upgrade: "websocket",
  connection: "Upgrade",
  "sec-websocket-version": "13",
  "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
}

function tokenCalls(): number {
  return twitch.fake.control.calls.filter((call) => call.path === "/oauth2/token").length
}

function distWithIndex(): string {
  const dist = join(dir.path, "dist")
  mkdirSync(dist)
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Rafflink</title>")
  writeFileSync(join(dist, "app.js"), "console.info('app')")
  writeFileSync(join(dist, "index-abc123.js"), "console.info('bundle')")
  return dist
}

async function createGiveaway(server: RunningServer, extra: Record<string, unknown> = {}) {
  const streamer = new Browser(server.url)
  await streamer.signInAs(
    users.streamer.id,
    `/auth/twitch/streamer/start?features=${streamerFeatures.join(",")}`,
    twitch.fake.control,
  )
  const response = await streamer.postJson("/api/dash/giveaways", {
    title: "Giveaway",
    prize: "Prize",
    rules: validRules,
    ...extra,
  })
  const body: { giveaway: { id: string; code: string; overlayToken: string } } =
    await response.json()
  return { streamer, ...body.giveaway }
}

function entrantCounts(messages: readonly { entrantCount: number }[]): number[] {
  return messages.map((message) => message.entrantCount)
}

function devAuthorizeQuery(hint: string): URLSearchParams {
  return new URLSearchParams({
    client_id: "client-1",
    redirect_uri: "http://localhost/callback",
    response_type: "code",
    login_hint: hint,
  })
}
