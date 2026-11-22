import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  createFakeTwitch,
  globalSubscriberBadgeUrl,
  profileImageUrlOf,
  websocket,
  type FakeTwitch,
  type FakeUser,
  type Tier,
} from "@rafflink/fake-twitch"
import { resolveConfig, type ResolvedConfig } from "../config.ts"
import {
  TwitchInvalid,
  TwitchRateLimited,
  TwitchUnavailable,
  TwitchClient,
  type TwitchFetch,
} from "./twitch-client.ts"
import type { SubscriptionGroup } from "../platform/provider.ts"

const redirectUri = "http://localhost/callback"
const viewer: FakeUser = {
  id: "100",
  login: "viewer",
  displayName: "Viewer",
  createdAt: "2021-03-04T05:06:07Z",
  profileImageUrl: profileImageUrlOf("viewer"),
}
const streamer: FakeUser = {
  id: "200",
  login: "streamer",
  displayName: "Streamer",
  createdAt: "2019-01-01T00:00:00Z",
  profileImageUrl: profileImageUrlOf("streamer"),
}
type Scopes = readonly [string, ...string[]]
const VIEWER_SCOPES: Scopes = ["openid", "user:read:subscriptions", "user:read:follows"]
const STREAMER_SCOPES: Scopes = ["openid", "channel:read:vips", "moderation:read"]
const CHAT_SCOPES: Scopes = ["openid", "user:read:chat"]

let fake: FakeTwitch
let server: ReturnType<typeof serveFake>
let client: TwitchClient

beforeEach(() => {
  fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: viewer,
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  fake.control.addUser(streamer)
  server = serveFake()
  client = new TwitchClient(configFor(server.url.origin), fetch)
})

afterEach(async () => {
  await server.stop(true)
})

function serveFake() {
  return Bun.serve({ port: 0, fetch: fake.app.fetch, websocket })
}

function configFor(origin: string, overrides: Record<string, string> = {}): ResolvedConfig {
  return resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: "key",
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

/** Signs `userId` in through the fake's authorize redirect and exchanges the code. */
async function signIn(userId: string, scopes: Scopes, nonce = "nonce-1") {
  fake.control.signInAs(userId)
  const authorize = await fetch(
    client.authorizeUrl({ state: "state-1", nonce, scopes, redirectUri }),
    { redirect: "manual" },
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code")
  return client.exchangeCode(code ?? "", redirectUri)
}

function callsTo(path: string): number {
  return fake.control.calls.filter((call) => call.path === path).length
}

/** Real fetch, except that URLs ending in `pathSuffix` get `answer` instead. */
function fetchExcept(pathSuffix: string, answer: () => Promise<Response>): TwitchFetch {
  return (input, init) => (String(input).endsWith(pathSuffix) ? answer() : fetch(input, init))
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the promise to reject")
}

describe("authorizeUrl", () => {
  it("carries client id, redirect, scopes, state and nonce", () => {
    const url = new URL(
      client.authorizeUrl({
        state: "s",
        nonce: "n",
        scopes: ["openid", "user:read:follows"],
        redirectUri,
      }),
    )
    expect(url.origin).toBe(server.url.origin)
    expect(url.pathname).toBe("/oauth2/authorize")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid user:read:follows",
      state: "s",
      nonce: "n",
    })
  })
})

describe("exchangeCode and verifyIdToken", () => {
  it("returns the user id of an id_token whose nonce matches", async () => {
    const tokens = await signIn("100", VIEWER_SCOPES, "nonce-1")

    expect(await client.verifyIdToken(tokens.idToken ?? "", "nonce-1")).toEqual({ userId: "100" })
  })

  it("rejects an id_token whose nonce differs", async () => {
    const tokens = await signIn("100", VIEWER_SCOPES, "nonce-1")

    const error = await rejection(client.verifyIdToken(tokens.idToken ?? "", "nonce-2"))

    expect(error).toBeInstanceOf(TwitchInvalid)
  })

  it("rejects an id_token with a bad signature, a wrong issuer or an expired exp", async () => {
    for (const fault of ["bad-signature", "wrong-issuer", "expired"] as const) {
      fake.control.tamperNextIdToken(fault)
      const tokens = await signIn("100", VIEWER_SCOPES, "nonce-1")

      const error = await rejection(client.verifyIdToken(tokens.idToken ?? "", "nonce-1"))

      expect(error).toBeInstanceOf(TwitchInvalid)
      expect(error).toMatchObject({ endpoint: "id-token" })
    }
  })

  it("accepts an id_token again after a tampered one was used up", async () => {
    fake.control.tamperNextIdToken("expired")
    await signIn("100", VIEWER_SCOPES, "nonce-1")

    const tokens = await signIn("100", VIEWER_SCOPES, "nonce-1")

    expect(await client.verifyIdToken(tokens.idToken ?? "", "nonce-1")).toEqual({ userId: "100" })
  })

  it("rejects an id_token issued for another client id", async () => {
    const tokens = await signIn("100", VIEWER_SCOPES)
    const other = new TwitchClient(
      configFor(server.url.origin, { TWITCH_CLIENT_ID: "client-2" }),
      fetch,
    )

    expect(await rejection(other.verifyIdToken(tokens.idToken ?? "", "nonce-1"))).toBeInstanceOf(
      TwitchInvalid,
    )
  })

  it("rejects text that is not a token", async () => {
    expect(await rejection(client.verifyIdToken("not-a-jwt", "nonce-1"))).toBeInstanceOf(
      TwitchInvalid,
    )
    expect(await rejection(client.verifyIdToken("", "nonce-1"))).toBeInstanceOf(TwitchInvalid)
  })

  it("classifies a failing key fetch as unavailable, not a raw TypeError", async () => {
    const tokens = await signIn("100", VIEWER_SCOPES)
    const offline = new TwitchClient(
      configFor(server.url.origin),
      fetchExcept("/oauth2/keys", () => Promise.reject(new TypeError("fetch failed"))),
    )

    const error = await rejection(offline.verifyIdToken(tokens.idToken ?? "", "nonce-1"))

    expect(error).toBeInstanceOf(TwitchUnavailable)
    expect(error).toMatchObject({ endpoint: "id-token" })
  })

  it("classifies a key endpoint that answers 500 as unavailable", async () => {
    const tokens = await signIn("100", VIEWER_SCOPES)
    const broken = new TwitchClient(
      configFor(server.url.origin),
      fetchExcept("/oauth2/keys", () => Promise.resolve(new Response(null, { status: 500 }))),
    )

    expect(await rejection(broken.verifyIdToken(tokens.idToken ?? "", "nonce-1"))).toBeInstanceOf(
      TwitchUnavailable,
    )
  })

  it("classifies a token endpoint 429 as rate limited and does not retry it", async () => {
    fake.control.failNext("token", 429, 1)

    expect(await rejection(client.exchangeCode("code", redirectUri))).toBeInstanceOf(
      TwitchRateLimited,
    )
    expect(callsTo("/oauth2/token")).toBe(1)
  })

  it("classifies a token endpoint 5xx as unavailable and does not retry it", async () => {
    fake.control.failNext("token", 502, 1)

    const error = await rejection(client.exchangeCode("code", redirectUri))

    expect(error).toBeInstanceOf(TwitchUnavailable)
    expect(error).toMatchObject({ endpoint: "token", status: 502 })
    expect(callsTo("/oauth2/token")).toBe(1)
  })

  it("classifies a rejected code as invalid", async () => {
    const error = await rejection(client.exchangeCode("never-issued", redirectUri))

    expect(error).toBeInstanceOf(TwitchInvalid)
    expect(error).toMatchObject({
      endpoint: "token",
      status: 400,
      reason: "Invalid authorization code",
    })
  })

  it("classifies a token endpoint that outlasts the timeout as unavailable", async () => {
    const stalled = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(500)
        return new Response("{}")
      },
    })
    try {
      const slow = new TwitchClient(
        configFor(stalled.url.origin, { TWITCH_TIMEOUT_MS: "50" }),
        fetch,
      )

      const error = await rejection(slow.exchangeCode("code", redirectUri))

      expect(error).toBeInstanceOf(TwitchUnavailable)
      expect(error).toMatchObject({ endpoint: "token", status: null })
      expect(error).toHaveProperty("cause")
    } finally {
      await stalled.stop(true)
    }
  })
})

describe("refreshTokens", () => {
  it("returns a working access token and the refresh token that replaces the old one", async () => {
    const first = await signIn("200", STREAMER_SCOPES)

    const refreshed = await client.refreshTokens(first.refreshToken)

    expect(refreshed.refreshToken).not.toBe(first.refreshToken)
    expect(await client.validate(refreshed.accessToken)).toEqual({ status: "valid", userId: "200" })
  })

  it("classifies a refresh token Twitch no longer knows as invalid with status 400 and its reason", async () => {
    const first = await signIn("200", STREAMER_SCOPES)
    fake.control.revokeUserTokens("200")

    const error = await rejection(client.refreshTokens(first.refreshToken))

    expect(error).toBeInstanceOf(TwitchInvalid)
    expect(error).toMatchObject({ endpoint: "token", status: 400, reason: "Invalid refresh token" })
  })

  it("classifies a token endpoint 503 as unavailable", async () => {
    const first = await signIn("200", STREAMER_SCOPES)
    fake.control.failNext("token", 503, 1)

    expect(await rejection(client.refreshTokens(first.refreshToken))).toBeInstanceOf(
      TwitchUnavailable,
    )
  })
})

describe("appAccessToken and userIdsByLogin", () => {
  it("gets an app token that resolves logins to ids, case-insensitively, and leaves unknown logins out", async () => {
    const token = await client.appAccessToken()

    const ids = await client.userIdsByLogin(token, ["streamer", "VIEWER", "nobody"])

    expect(ids).toEqual(
      new Map([
        ["streamer", "200"],
        ["viewer", "100"],
      ]),
    )
  })

  it("sends at most 100 logins per call", async () => {
    for (let n = 0; n < 150; n++) {
      fake.control.addUser({
        id: `${1000 + n}`,
        login: `user${n}`,
        displayName: `U${n}`,
        createdAt: "2020-01-01T00:00:00Z",
        profileImageUrl: profileImageUrlOf(`user${n}`),
      })
    }
    const token = await client.appAccessToken()

    const ids = await client.userIdsByLogin(
      token,
      Array.from({ length: 150 }, (_, n) => `user${n}`),
    )

    expect(ids.size).toBe(150)
    expect(ids.get("user149")).toBe("1149")
    expect(callsTo("/helix/users")).toBe(2)
  })

  it("reuses the app token until it nears its end and mints one at once for callers together", async () => {
    const now = spyOn(Date, "now")
    now.mockReturnValue(1_000_000)
    const [first, second] = await Promise.all([client.appAccessToken(), client.appAccessToken()])
    const third = await client.appAccessToken()

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(callsTo("/oauth2/token")).toBe(1)

    now.mockReturnValue(1_000_000 + 5_184_000 * 1000)
    const renewed = await client.appAccessToken()

    expect(renewed).not.toBe(first)
    expect(callsTo("/oauth2/token")).toBe(2)
    now.mockRestore()
  })

  it("does not keep a failed app token request", async () => {
    fake.control.failNext("token", 503, 1)

    expect(await rejection(client.appAccessToken())).toBeInstanceOf(TwitchUnavailable)
    expect(typeof (await client.appAccessToken())).toBe("string")
  })

  it("classifies a token endpoint 429 on the app token as rate limited", async () => {
    fake.control.failNext("token", 429, 1)

    expect(await rejection(client.appAccessToken())).toBeInstanceOf(TwitchRateLimited)
  })

  it("rejects a login lookup with a token Twitch does not know as invalid", async () => {
    expect(await rejection(client.userIdsByLogin("unknown", ["streamer"]))).toBeInstanceOf(
      TwitchInvalid,
    )
  })
})

describe("Helix", () => {
  it("retries a Helix 503 once and then fails", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.failNext("subscriptions", 503, 3)

    const error = await rejection(client.subscriptionTier(accessToken, "200", "100"))

    expect(error).toBeInstanceOf(TwitchUnavailable)
    expect(error).toMatchObject({ endpoint: "subscriptions", status: 503 })
    expect(callsTo("/helix/subscriptions/user")).toBe(2)
  })

  it("returns the answer when the single retry after a Helix 503 succeeds", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.setSubscription("100", "200", "2000")
    fake.control.failNext("subscriptions", 503, 1)

    expect(await client.subscriptionTier(accessToken, "200", "100")).toBe("sub_t2")
    expect(callsTo("/helix/subscriptions/user")).toBe(2)
  })

  it("does not retry a Helix 429 and classifies it as rate limited", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.failNext("followed", 429, 1)

    expect(await rejection(client.follows(accessToken, "200", "100"))).toBeInstanceOf(
      TwitchRateLimited,
    )
    expect(callsTo("/helix/channels/followed")).toBe(1)
  })

  it("does not retry a Helix 500", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.failNext("users", 500, 1)

    expect(await rejection(client.userProfile(accessToken))).toBeInstanceOf(TwitchUnavailable)
    expect(callsTo("/helix/users")).toBe(1)
  })

  it("classifies a Helix 401 as invalid", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.revokeUserTokens("100")

    const error = await rejection(client.follows(accessToken, "200", "100"))

    expect(error).toBeInstanceOf(TwitchInvalid)
    expect(error).toMatchObject({ endpoint: "followed", status: 401 })
  })

  it("maps a 404 on the subscription to not subscribed", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect(await client.subscriptionTier(accessToken, "200", "100")).toBeNull()
  })

  it("maps each Twitch tier to its group", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    const cases: readonly [Tier, SubscriptionGroup][] = [
      ["1000", "sub_t1"],
      ["2000", "sub_t2"],
      ["3000", "sub_t3"],
    ]

    for (const [tier, group] of cases) {
      fake.control.setSubscription("100", "200", tier)
      expect(await client.subscriptionTier(accessToken, "200", "100")).toBe(group)
    }
  })

  it("reports not following when the followed list is empty", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect(await client.follows(accessToken, "200", "100")).toBe(false)
  })

  it("reports following when the broadcaster is on the followed list", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.setFollowing("100", "200", true)

    expect(await client.follows(accessToken, "200", "100")).toBe(true)
  })

  it("reads the account creation time of the token owner", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect((await client.userProfile(accessToken)).createdAt).toBe(
      Date.parse("2021-03-04T05:06:07Z"),
    )
  })

  it("reads login, display name and creation time of the token owner", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect(await client.userProfile(accessToken)).toEqual({
      login: "viewer",
      displayName: "Viewer",
      createdAt: Date.parse("2021-03-04T05:06:07Z"),
      profileImageUrl: profileImageUrlOf("viewer"),
    })
  })

  it("reads no profile picture when Twitch's URL is not on its image host", async () => {
    fake.control.addUser({ ...viewer, profileImageUrl: "https://example.com/me.png" })
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect((await client.userProfile(accessToken)).profileImageUrl).toBeNull()
  })
})

describe("subscriber badges", () => {
  const t1 = "https://static-cdn.jtvnw.net/badges/v1/t1/2"
  const t3 = "https://static-cdn.jtvnw.net/badges/v1/t3/2"

  it("reads the images of the tiers a channel set and null for the rest", async () => {
    fake.control.setChannelSubscriberBadges("200", { "1000": t1, "3000": t3 })

    expect(await client.channelSubscriberBadges(await client.appAccessToken(), "200")).toEqual({
      sub_t1: t1,
      sub_t2: null,
      sub_t3: t3,
    })
  })

  it("reads nothing for a channel without its own badge set", async () => {
    expect(await client.channelSubscriberBadges(await client.appAccessToken(), "200")).toEqual({
      sub_t1: null,
      sub_t2: null,
      sub_t3: null,
    })
  })

  it("ignores a badge image that is not on Twitch's image host", async () => {
    fake.control.setChannelSubscriberBadges("200", {
      "1000": "https://example.com/t1.png",
      "2000": t1,
    })

    expect(await client.channelSubscriberBadges(await client.appAccessToken(), "200")).toEqual({
      sub_t1: null,
      sub_t2: t1,
      sub_t3: null,
    })
  })

  it("reads the global subscriber badge", async () => {
    expect(await client.globalSubscriberBadge(await client.appAccessToken())).toBe(
      globalSubscriberBadgeUrl,
    )
  })

  it("classifies a 503 on the badges endpoint as unavailable", async () => {
    const token = await client.appAccessToken()
    fake.control.failNext("badges", 503, 2)

    expect(await rejection(client.globalSubscriberBadge(token))).toBeInstanceOf(TwitchUnavailable)
  })
})

describe("channelRoles", () => {
  it("follows the cursor over more than one page of VIPs", async () => {
    const vipIds = Array.from({ length: 150 }, (_, index) => String(1000 + index))
    for (const id of vipIds) {
      fake.control.addUser({
        id,
        login: `vip${id}`,
        displayName: `Vip${id}`,
        createdAt: viewer.createdAt,
        profileImageUrl: profileImageUrlOf(`vip${id}`),
      })
      fake.control.setRole("200", id, "vip", true)
    }
    fake.control.setRole("200", "100", "moderator", true)
    const { accessToken } = await signIn("200", STREAMER_SCOPES)

    const roles = await client.channelRoles(accessToken, "200")

    expect(roles.vips).toEqual(vipIds)
    expect(roles.moderators).toEqual(["100"])
    const vipRequests = fake.control.calls.filter((call) => call.path === "/helix/channels/vips")
    expect(vipRequests.map((call) => call.query.first)).toEqual(["100", "100"])
    expect(vipRequests.map((call) => call.query.after)).toEqual([undefined, "100"])
  })

  it("returns empty lists for a channel without roles", async () => {
    const { accessToken } = await signIn("200", STREAMER_SCOPES)

    expect(await client.channelRoles(accessToken, "200")).toEqual({ vips: [], moderators: [] })
  })

  it("fails the whole refresh when the moderator list is unavailable after a retry", async () => {
    const { accessToken } = await signIn("200", STREAMER_SCOPES)
    fake.control.failNext("moderators", 503, 2)

    const error = await rejection(client.channelRoles(accessToken, "200"))

    expect(error).toBeInstanceOf(TwitchUnavailable)
    expect(error).toMatchObject({ endpoint: "moderators" })
    expect(callsTo("/helix/moderation/moderators")).toBe(2)
  })
})

describe("subscribeChatMessages", () => {
  it("delivers the channel's chat messages to the session", async () => {
    const { accessToken } = await signIn("200", CHAT_SCOPES)
    const session = await openSession()

    await client.subscribeChatMessages(accessToken, "200", session.id)
    fake.control.sendChatMessage("200", "100", "!claim")

    expect(await session.nextNotification()).toMatchObject({
      payload: {
        subscription: { condition: { broadcaster_user_id: "200", user_id: "200" } },
        event: { chatter_user_id: "100", message: { text: "!claim" } },
      },
    })
  })

  it("retries a Helix 503 once", async () => {
    const { accessToken } = await signIn("200", CHAT_SCOPES)
    const session = await openSession()
    fake.control.failNext("eventsub", 503, 1)

    await client.subscribeChatMessages(accessToken, "200", session.id)

    expect(callsTo("/helix/eventsub/subscriptions")).toBe(2)
  })

  it("rejects a token without the chat scope as invalid", async () => {
    const { accessToken } = await signIn("200", STREAMER_SCOPES)
    const session = await openSession()

    const error = await rejection(client.subscribeChatMessages(accessToken, "200", session.id))

    expect(error).toBeInstanceOf(TwitchInvalid)
    expect(error).toMatchObject({ endpoint: "eventsub", status: 403 })
  })

  it("rejects a session that does not exist as invalid", async () => {
    const { accessToken } = await signIn("200", CHAT_SCOPES)

    const error = await rejection(client.subscribeChatMessages(accessToken, "200", "gone"))

    expect(error).toMatchObject({ endpoint: "eventsub", status: 400 })
  })
})

describe("validate", () => {
  it("reports a live token as valid with its user id", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)

    expect(await client.validate(accessToken)).toEqual({ status: "valid", userId: "100" })
  })

  it("reports a 401 as invalid", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    fake.control.revokeUserTokens("100")

    expect(await client.validate(accessToken)).toEqual({ status: "invalid" })
  })

  it("reports a 503 as unavailable without retrying", async () => {
    const { accessToken } = await signIn("100", VIEWER_SCOPES)
    const unwell = new TwitchClient(
      configFor(server.url.origin),
      fetchExcept("/oauth2/validate", () => Promise.resolve(new Response(null, { status: 503 }))),
    )

    expect(await unwell.validate(accessToken)).toEqual({ status: "unavailable" })
  })

  it("reports a network failure as unavailable", async () => {
    const offline = new TwitchClient(configFor(server.url.origin), () =>
      Promise.reject(new TypeError("fetch failed")),
    )

    expect(await offline.validate("token")).toEqual({ status: "unavailable" })
  })

  it("reports a 429 as unavailable so the token is kept", async () => {
    const throttled = new TwitchClient(configFor(server.url.origin), () =>
      Promise.resolve(new Response(null, { status: 429 })),
    )

    expect(await throttled.validate("token")).toEqual({ status: "unavailable" })
  })
})

interface SocketMessage {
  metadata: { message_type: string }
  payload: { session?: { id: string } }
}

interface Session {
  readonly id: string
  nextNotification(): Promise<SocketMessage>
}

/** Opens an EventSub socket on the fake and reads its welcome; the server closes the socket when the test ends. */
async function openSession(): Promise<Session> {
  const socket = new WebSocket(`ws://${server.hostname}:${server.port}/eventsub/ws`)
  const queue: SocketMessage[] = []
  const waiting: ((message: SocketMessage) => void)[] = []
  socket.addEventListener("message", (event) => {
    const message: SocketMessage = JSON.parse(String(event.data))
    const waiter = waiting.shift()
    if (waiter === undefined) queue.push(message)
    else waiter(message)
  })
  const next = (): Promise<SocketMessage> => {
    const queued = queue.shift()
    return queued === undefined
      ? new Promise((resolve) => waiting.push(resolve))
      : Promise.resolve(queued)
  }
  const id = (await next()).payload.session?.id
  if (id === undefined) throw new Error("first message was not a welcome")
  return {
    id,
    nextNotification: async () => {
      for (;;) {
        const message = await next()
        if (message.metadata.message_type === "notification") return message
      }
    },
  }
}

describe("authorizeUrl force_verify", () => {
  const params = { state: "s", nonce: "n", scopes: ["openid"], redirectUri } as const

  it("leaves force_verify out by default and sets it when asked", () => {
    const plain = new URL(client.authorizeUrl(params))
    const forced = new URL(client.authorizeUrl({ ...params, forceVerify: true }))

    expect(plain.searchParams.has("force_verify")).toBe(false)
    expect(forced.searchParams.get("force_verify")).toBe("true")
  })

  it("signs in as usual through a fake Twitch that gets force_verify", async () => {
    const response = await fetch(client.authorizeUrl({ ...params, forceVerify: true }), {
      redirect: "manual",
    })

    expect(new URL(response.headers.get("location") ?? "").searchParams.get("code")).toBeString()
  })
})
