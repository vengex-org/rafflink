import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createFakeTwitch, type FakeTwitch, type FakeUser } from "@rafflink/fake-twitch"
import { accountsSchema, secureRandom, sqlRows, TestClock } from "../../test/app-fixture.ts"
import { resolveConfig, type ResolvedConfig } from "../config.ts"
import { toBase64 } from "../lib/encoding.ts"
import { openKeyRing, openSecret, sealSecret, type KeyRing } from "../lib/seal.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import { TwitchClient, type TwitchFetch } from "../twitch/twitch-client.ts"
import { AccountStore } from "./account-store.ts"
import { streamerTokenAad, type StreamerTokenDeps } from "./streamer-token.ts"
import { validateStreamerTokens } from "./validate-streamer-tokens.ts"

const REDIRECT_URI = "http://localhost/callback"
const sealKey = `test:${toBase64(new Uint8Array(32).fill(3))}`

let fake: FakeTwitch
let server: Bun.Server<undefined>
let db: Database
let accounts: AccountStore
let keyRing: KeyRing
let config: ResolvedConfig

beforeEach(async () => {
  fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: user("100"),
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  for (const id of ["200", "201", "202"]) fake.control.addUser(user(id))
  server = Bun.serve({ port: 0, fetch: fake.app.fetch })
  config = configFor(server.url.origin, {})
  db = new Database(":memory:")
  db.exec(accountsSchema)
  accounts = new AccountStore(new BunSqliteAsyncSql(db), config)
  keyRing = await openKeyRing([sealKey])
})

afterEach(async () => {
  await server.stop(true)
})

function user(id: string): FakeUser {
  return { id, login: `user_${id}`, displayName: `User_${id}`, createdAt: "2019-01-01T00:00:00Z" }
}

function configFor(origin: string, overrides: Record<string, string>): ResolvedConfig {
  return resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: sealKey,
    SESSION_SECRET: "session",
    ADMIN_TWITCH_IDS: "1",
    PUBLIC_URL: "http://localhost",
    TWITCH_ID_BASE_URL: origin,
    TWITCH_HELIX_BASE_URL: origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
    ...overrides,
  })
}

function deps(twitchFetch: TwitchFetch = fetch, twitchConfig = config): StreamerTokenDeps {
  return {
    clock: new TestClock(5000),
    random: secureRandom,
    twitch: new TwitchClient(twitchConfig, twitchFetch),
    accounts,
    keyRing,
  }
}

/** Real fetch, except that URLs ending in `pathSuffix` get `answer` instead. */
function fetchExcept(pathSuffix: string, answer: () => Promise<Response>): TwitchFetch {
  return (input, init) => (String(input).endsWith(pathSuffix) ? answer() : fetch(input, init))
}

/** Signs the fake user in and stores their sealed refresh token as streamer `id`; returns that refresh token. */
async function storeStreamer(id: string, userId: string, sealedAs = userId): Promise<string> {
  fake.control.signInAs(userId)
  const { twitch } = deps()
  const authorize = await fetch(
    twitch.authorizeUrl({ state: "s", nonce: "n", scopes: ["openid"], redirectUri: REDIRECT_URI }),
    { redirect: "manual" },
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code")
  const tokens = await twitch.exchangeCode(code ?? "", REDIRECT_URI)
  await accounts.signInStreamer({
    id,
    platform: "twitch",
    platformUserId: userId,
    login: `user_${userId}`,
    sealedRefreshToken: await sealSecret(
      keyRing,
      tokens.refreshToken,
      streamerTokenAad("twitch", sealedAs),
      secureRandom,
    ),
    scopes: "openid",
    now: 1000,
  })
  return tokens.refreshToken
}

const offline: TwitchFetch = () => Promise.reject(new TypeError("fetch failed"))

function storedIds(): string[] {
  return sqlRows(db, "SELECT streamer_id FROM streamer_tokens ORDER BY streamer_id").map((row) =>
    String(row.streamer_id),
  )
}

describe("validateStreamerTokens", () => {
  it("reports zeros when no streamer signed in", async () => {
    expect(await validateStreamerTokens(deps())).toEqual({ deleted: 0, kept: 0, failed: 0 })
  })

  it("keeps a token Twitch accepts and stores the refresh token Twitch returned", async () => {
    const original = await storeStreamer("a", "200")

    const result = await validateStreamerTokens(deps())

    expect(result).toEqual({ deleted: 0, kept: 1, failed: 0 })
    const [stored] = await accounts.listStreamerTokens()
    const reopened = await openSecret(
      keyRing,
      stored?.sealedRefreshToken ?? "",
      streamerTokenAad("twitch", "200"),
    )
    expect(reopened).not.toBe(original)
  })

  it("deletes the token of a streamer whose refresh token Twitch rejects and keeps the streamer", async () => {
    await storeStreamer("a", "200")
    fake.control.revokeUserTokens("200")

    const result = await validateStreamerTokens(deps())

    expect(result).toEqual({ deleted: 1, kept: 0, failed: 0 })
    expect(storedIds()).toEqual([])
    expect(sqlRows(db, "SELECT id FROM streamers")).toEqual([{ id: "a" }])
  })

  it("deletes a token whose fresh access token validate answers 401 for", async () => {
    await storeStreamer("a", "200")
    const rejecting = fetchExcept("/oauth2/validate", () =>
      Promise.resolve(new Response(null, { status: 401 })),
    )

    expect(await validateStreamerTokens(deps(rejecting))).toEqual({
      deleted: 1,
      kept: 0,
      failed: 0,
    })
    expect(storedIds()).toEqual([])
  })

  it("keeps the token when the token endpoint answers 5xx", async () => {
    await storeStreamer("a", "200")
    fake.control.failNext("token", 503, 1)

    expect(await validateStreamerTokens(deps())).toEqual({ deleted: 0, kept: 1, failed: 0 })
    expect(storedIds()).toEqual(["a"])
  })

  it("keeps the token when the token endpoint answers 429", async () => {
    await storeStreamer("a", "200")
    fake.control.failNext("token", 429, 1)

    expect(await validateStreamerTokens(deps())).toEqual({ deleted: 0, kept: 1, failed: 0 })
  })

  it("keeps the token when validate answers 5xx", async () => {
    await storeStreamer("a", "200")
    const unwell = fetchExcept("/oauth2/validate", () =>
      Promise.resolve(new Response(null, { status: 503 })),
    )

    expect(await validateStreamerTokens(deps(unwell))).toEqual({ deleted: 0, kept: 1, failed: 0 })
    expect(storedIds()).toEqual(["a"])
  })

  it("keeps the token when Twitch cannot be reached", async () => {
    await storeStreamer("a", "200")

    expect(await validateStreamerTokens(deps(offline))).toEqual({ deleted: 0, kept: 1, failed: 0 })
  })

  it("counts a 400 from a wrong client id as failed and deletes nothing", async () => {
    await storeStreamer("a", "200")
    const wrongId = configFor(server.url.origin, { TWITCH_CLIENT_ID: "wrong" })

    expect(await validateStreamerTokens(deps(fetch, wrongId))).toEqual({
      deleted: 0,
      kept: 0,
      failed: 1,
    })
    expect(storedIds()).toEqual(["a"])
  })

  it("counts a 403 from a wrong client secret as failed and deletes nothing", async () => {
    await storeStreamer("a", "200")
    const wrongSecret = configFor(server.url.origin, { TWITCH_CLIENT_SECRET: "wrong" })

    expect(await validateStreamerTokens(deps(fetch, wrongSecret))).toEqual({
      deleted: 0,
      kept: 0,
      failed: 1,
    })
    expect(storedIds()).toEqual(["a"])
  })

  it("counts a token that does not open as failed and still checks the next one", async () => {
    await storeStreamer("a", "200")
    await storeStreamer("b", "201")
    await accounts.replaceStreamerToken("a", "not-a-sealed-value", 2000)
    fake.control.revokeUserTokens("201")

    const result = await validateStreamerTokens(deps())

    expect(result).toEqual({ deleted: 1, kept: 0, failed: 1 })
    expect(storedIds()).toEqual(["a"])
  })

  it("counts a token sealed to another user as failed", async () => {
    await storeStreamer("a", "200", "201")

    expect(await validateStreamerTokens(deps())).toEqual({ deleted: 0, kept: 0, failed: 1 })
  })

  it("counts each outcome across several streamers", async () => {
    await storeStreamer("a", "200")
    await storeStreamer("b", "201")
    await storeStreamer("c", "202")
    fake.control.revokeUserTokens("201")
    fake.control.failNext("token", 503, 1)

    const result = await validateStreamerTokens(deps())

    expect(result).toEqual({ deleted: 1, kept: 2, failed: 0 })
    expect(storedIds()).toEqual(["a", "c"])
  })
})
