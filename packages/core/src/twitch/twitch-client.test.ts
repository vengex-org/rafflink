import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  createFakeTwitch,
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
  type SubscriptionGroup,
  type TwitchFetch,
} from "./twitch-client.ts"

const REDIRECT_URI = "http://localhost/callback"
const viewer: FakeUser = {
  id: "100",
  login: "viewer",
  displayName: "Viewer",
  createdAt: "2021-03-04T05:06:07Z",
}
const streamer: FakeUser = {
  id: "200",
  login: "streamer",
  displayName: "Streamer",
  createdAt: "2019-01-01T00:00:00Z",
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
    client.authorizeUrl({ state: "state-1", nonce, scopes, redirectUri: REDIRECT_URI }),
    { redirect: "manual" },
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code")
  return client.exchangeCode(code ?? "", REDIRECT_URI)
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
        redirectUri: REDIRECT_URI,
      }),
    )
    expect(url.origin).toBe(server.url.origin)
    expect(url.pathname).toBe("/oauth2/authorize")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: REDIRECT_URI,
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

    expect(await rejection(client.exchangeCode("code", REDIRECT_URI))).toBeInstanceOf(
      TwitchRateLimited,
    )
    expect(callsTo("/oauth2/token")).toBe(1)
  })

  it("classifies a token endpoint 5xx as unavailable and does not retry it", async () => {
    fake.control.failNext("token", 502, 1)

    const error = await rejection(client.exchangeCode("code", REDIRECT_URI))

    expect(error).toBeInstanceOf(TwitchUnavailable)
    expect(error).toMatchObject({ endpoint: "token", status: 502 })
    expect(callsTo("/oauth2/token")).toBe(1)
  })

  it("classifies a rejected code as invalid", async () => {
    const error = await rejection(client.exchangeCode("never-issued", REDIRECT_URI))

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

      const error = await rejection(slow.exchangeCode("code", REDIRECT_URI))

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
    })
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
