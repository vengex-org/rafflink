import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { serveFakeTwitch, type FakeTwitchOptions, type FakeUser } from "../src/index.ts"

const options: FakeTwitchOptions = {
  clientId: "client-1",
  clientSecret: "secret-1",
  defaultUser: {
    id: "100",
    login: "viewer",
    displayName: "Viewer",
    createdAt: "2021-03-04T05:06:07Z",
  },
  subscribeWindowMs: 300,
  keepaliveTimeoutSeconds: 0.2,
}
const streamer: FakeUser = {
  id: "200",
  login: "streamer",
  displayName: "Streamer",
  createdAt: "2019-01-01T00:00:00Z",
}
const REDIRECT_URI = "http://localhost/callback"

type Fake = ReturnType<typeof serveFakeTwitch>
interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string[]
  token_type: string
  id_token?: string
}
interface SocketMessage {
  metadata: { message_type: string }
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url: string | null }
  }
}

let fake: Fake
let sockets: WebSocket[]

beforeEach(() => {
  fake = serveFakeTwitch(0, options)
  fake.control.addUser(streamer)
  sockets = []
})

afterEach(async () => {
  for (const socket of sockets) socket.close()
  await fake.server.stop(true)
})

describe("id service", () => {
  test("issues an id_token that verifies against its JWKS", async () => {
    const tokens = await signIn("openid", "nonce-1")

    const jwks = createRemoteJWKSet(url("/oauth2/keys"))
    const { payload, protectedHeader } = await jwtVerify(tokens.id_token ?? "", jwks, {
      issuer: "https://id.twitch.tv/oauth2",
      audience: options.clientId,
    })

    expect(protectedHeader.alg).toBe("RS256")
    expect(protectedHeader.kid).toBeString()
    expect(payload.sub).toBe("100")
    expect(payload["nonce"]).toBe("nonce-1")
    expect(payload["preferred_username"]).toBe("viewer")
    expect(tokens.scope).toEqual(["openid"])
    expect(tokens.token_type).toBe("bearer")
  })

  test("returns no id_token when the openid scope was not requested", async () => {
    const tokens = await signIn("user:read:follows")

    expect(tokens.id_token).toBeUndefined()
  })

  test("signs in the user chosen with signInAs", async () => {
    fake.control.signInAs("200")

    const tokens = await signIn("openid")
    const jwks = createRemoteJWKSet(url("/oauth2/keys"))
    const { payload } = await jwtVerify(tokens.id_token ?? "", jwks)

    expect(payload.sub).toBe("200")
  })

  test("redirects authorize back with the code and the state", async () => {
    const response = await authorize("openid", undefined, "state-1")

    const location = new URL(response.headers.get("location") ?? "")
    expect(response.status).toBe(302)
    expect(location.origin + location.pathname).toBe(REDIRECT_URI)
    expect(location.searchParams.get("state")).toBe("state-1")
    expect(location.searchParams.get("code")).toBeString()
  })

  test("signs in the user named by login_hint without changing the default", async () => {
    const hinted = await authorizeWithHint("200")
    const jwks = createRemoteJWKSet(url("/oauth2/keys"))
    const hintedTokens: TokenResponse = await (await exchangeCode(hinted)).json()
    const { payload } = await jwtVerify(hintedTokens.id_token ?? "", jwks)
    const next = await signIn("openid")
    const { payload: nextPayload } = await jwtVerify(next.id_token ?? "", jwks)

    expect(payload.sub).toBe("200")
    expect(nextPayload.sub).toBe("100")
  })

  test("knows the dev users by login_hint", async () => {
    const response = await fetch(url(`/oauth2/authorize?${hintQuery("1001")}`), {
      redirect: "manual",
    })

    expect(response.status).toBe(302)
  })

  test("rejects a login_hint that names no user", async () => {
    const response = await fetch(url(`/oauth2/authorize?${hintQuery("999")}`), {
      redirect: "manual",
    })

    expect(response.status).toBe(400)
  })

  test("rejects authorize for an unknown client", async () => {
    const response = await fetch(
      url("/oauth2/authorize?client_id=other&response_type=code&redirect_uri=" + REDIRECT_URI),
      {
        redirect: "manual",
      },
    )

    expect(response.status).toBe(400)
  })

  test("accepts an authorization code only once", async () => {
    const code = await authorizeCode("openid")

    const first = await exchangeCode(code)
    const second = await exchangeCode(code)

    expect(first.status).toBe(200)
    expect(second.status).toBe(400)
    expect(await second.json()).toEqual({ status: 400, message: "Invalid authorization code" })
  })

  test("rejects a wrong client secret", async () => {
    const code = await authorizeCode("openid")

    const response = await exchangeCode(code, "wrong")

    expect(response.status).toBe(403)
  })

  test("answers a scripted 429 on the token endpoint with an empty body, then recovers", async () => {
    const code = await authorizeCode("openid")
    fake.control.failNext("token", 429, 2)

    const first = await exchangeCode(code)
    const second = await exchangeCode(code)
    const third = await exchangeCode(code)

    expect([first.status, second.status, third.status]).toEqual([429, 429, 200])
    expect(await first.text()).toBe("")
  })

  test("answers a scripted 503 on the token endpoint", async () => {
    fake.control.failNext("token", 503, 1)

    const response = await exchangeCode(await authorizeCode("openid"))

    expect(response.status).toBe(503)
  })

  test("refreshes a token once and rejects the used refresh token", async () => {
    const tokens = await signIn("user:read:follows")

    const refreshed = await refresh(tokens.refresh_token)
    const reused = await refresh(tokens.refresh_token)

    expect(refreshed.status).toBe(200)
    const body: TokenResponse = await refreshed.json()
    expect(body.access_token).not.toBe(tokens.access_token)
    expect(body.scope).toEqual(["user:read:follows"])
    expect(reused.status).toBe(400)
  })

  test("rejects an unknown grant type", async () => {
    const response = await postToken({ grant_type: "password" })

    expect(response.status).toBe(400)
  })

  test("validates a live token and rejects it after the user's tokens are revoked", async () => {
    const tokens = await signIn("openid user:read:follows")

    const live = await validate(tokens.access_token)
    fake.control.revokeUserTokens("100")
    const revoked = await validate(tokens.access_token)
    const refreshed = await refresh(tokens.refresh_token)

    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({
      client_id: "client-1",
      login: "viewer",
      scopes: ["openid", "user:read:follows"],
      user_id: "100",
      expires_in: 14_400,
    })
    expect(revoked.status).toBe(401)
    expect(await revoked.json()).toEqual({ status: 401, message: "invalid access token" })
    expect(refreshed.status).toBe(400)
  })
})

describe("helix", () => {
  test("answers 404 when the viewer is not subscribed and the tier when subscribed", async () => {
    const tokens = await signIn("user:read:subscriptions")
    const path = "/helix/subscriptions/user?broadcaster_id=200&user_id=100"

    const notSubscribed = await helix(path, tokens.access_token)
    fake.control.setSubscription("100", "200", "2000")
    const subscribed = await helix(path, tokens.access_token)

    expect(notSubscribed.status).toBe(404)
    expect(subscribed.status).toBe(200)
    expect(await subscribed.json()).toMatchObject({
      data: [{ broadcaster_id: "200", tier: "2000", is_gift: false }],
    })
  })

  test("returns empty data when the viewer does not follow and one entry when they do", async () => {
    const tokens = await signIn("user:read:follows")
    const path = "/helix/channels/followed?user_id=100&broadcaster_id=200"

    const notFollowing = await helix(path, tokens.access_token)
    fake.control.setFollowing("100", "200", true)
    const following = await helix(path, tokens.access_token)

    expect(await notFollowing.json()).toEqual({ total: 0, data: [], pagination: {} })
    expect(await following.json()).toMatchObject({ total: 1, data: [{ broadcaster_id: "200" }] })
  })

  test("refuses a user_id that is not the token's user", async () => {
    const tokens = await signIn("user:read:follows")

    const response = await helix(
      "/helix/channels/followed?user_id=200&broadcaster_id=200",
      tokens.access_token,
    )

    expect(response.status).toBe(400)
  })

  test("returns created_at for the requested users and for the token's user by default", async () => {
    const tokens = await signIn("openid")

    const byId = await helix("/helix/users?id=200", tokens.access_token)
    const self = await helix("/helix/users", tokens.access_token)

    expect(await byId.json()).toMatchObject({
      data: [{ id: "200", login: "streamer", created_at: streamer.createdAt }],
    })
    expect(await self.json()).toMatchObject({
      data: [{ id: "100", created_at: options.defaultUser.createdAt }],
    })
  })

  test("rejects a missing token, a revoked token, a wrong Client-Id and a missing scope", async () => {
    const tokens = await signIn("user:read:follows")
    const path = "/helix/users"

    const noToken = await fetch(url(path), { headers: { "Client-Id": options.clientId } })
    const wrongClient = await fetch(url(path), {
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Client-Id": "other" },
    })
    const noScope = await helix(
      "/helix/subscriptions/user?broadcaster_id=200&user_id=100",
      tokens.access_token,
    )
    fake.control.revokeUserTokens("100")
    const revoked = await helix(path, tokens.access_token)

    expect([noToken.status, wrongClient.status, noScope.status, revoked.status]).toEqual([
      401, 401, 401, 401,
    ])
  })

  test("pages VIPs by cursor with at most 100 per page", async () => {
    fake.control.signInAs("200")
    const tokens = await signIn("channel:read:vips")
    for (let id = 1; id <= 150; id++) {
      fake.control.addUser({
        id: `v${id}`,
        login: `vip${id}`,
        displayName: `Vip${id}`,
        createdAt: "2020-01-01T00:00:00Z",
      })
      fake.control.setRole("200", `v${id}`, "vip", true)
    }

    const first = await listIds(
      "/helix/channels/vips?broadcaster_id=200&first=100",
      tokens.access_token,
    )
    const second = await listIds(
      `/helix/channels/vips?broadcaster_id=200&first=100&after=${first.cursor}`,
      tokens.access_token,
    )

    expect(first.ids).toHaveLength(100)
    expect(first.cursor).toBe("100")
    expect(second.ids).toHaveLength(50)
    expect(second.cursor).toBeUndefined()
    expect(new Set([...first.ids, ...second.ids]).size).toBe(150)
  })

  test("rejects a page size outside 1 to 100 and a bad cursor", async () => {
    fake.control.signInAs("200")
    const tokens = await signIn("channel:read:vips")
    const base = "/helix/channels/vips?broadcaster_id=200"

    const statuses = await Promise.all(
      ["&first=0", "&first=101", "&first=1.5", "&first=abc", "&after=-1", "&after=x"].map(
        async (query) => (await helix(base + query, tokens.access_token)).status,
      ),
    )

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400])
  })

  test("lists moderators and refuses a broadcaster_id that is not the token's user", async () => {
    fake.control.signInAs("200")
    const tokens = await signIn("moderation:read")
    fake.control.setRole("200", "100", "moderator", true)

    const own = await helix("/helix/moderation/moderators?broadcaster_id=200", tokens.access_token)
    const foreign = await helix(
      "/helix/moderation/moderators?broadcaster_id=100",
      tokens.access_token,
    )

    expect(await own.json()).toEqual({
      data: [{ user_id: "100", user_name: "Viewer", user_login: "viewer" }],
      pagination: {},
    })
    expect(foreign.status).toBe(401)
  })

  test("answers scripted 503 and 429 per endpoint without touching the others", async () => {
    fake.control.signInAs("200")
    const tokens = await signIn("channel:read:vips moderation:read")
    fake.control.failNext("vips", 503, 1)
    fake.control.failNext("moderators", 429, 1)

    const vipDown = await helix("/helix/channels/vips?broadcaster_id=200", tokens.access_token)
    const vipBack = await helix("/helix/channels/vips?broadcaster_id=200", tokens.access_token)
    const modLimited = await helix(
      "/helix/moderation/moderators?broadcaster_id=200",
      tokens.access_token,
    )

    expect([vipDown.status, vipBack.status, modLimited.status]).toEqual([503, 200, 429])
    expect(await modLimited.json()).toMatchObject({ error: "Too Many Requests", status: 429 })
  })

  test("records every request in control.calls", async () => {
    const tokens = await signIn("openid")
    await helix("/helix/users?id=200", tokens.access_token)

    expect(fake.control.calls.at(-1)).toEqual({
      method: "GET",
      path: "/helix/users",
      query: { id: "200" },
    })
  })

  test("throws when a control setter names an unknown user", () => {
    expect(() => fake.control.setFollowing("100", "missing", true)).toThrow("missing")
  })
})

describe("eventsub websocket", () => {
  test("sends a welcome with a session id and the keepalive timeout", async () => {
    const socket = await openSocket()

    const welcome = await socket.next()

    expect(welcome.metadata.message_type).toBe("session_welcome")
    expect(welcome.payload.session?.id).toBeString()
    expect(welcome.payload.session?.keepalive_timeout_seconds).toBe(0.2)
  })

  test("delivers a chat message to a socket subscribed to the broadcaster", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")

    const subscribed = await subscribe(tokens.access_token, sessionId, "100", "100")
    fake.control.sendChatMessage("100", "200", "!claim")
    const message = await socket.nextOfType("notification")

    expect(subscribed.status).toBe(202)
    expect(message).toMatchObject({
      metadata: { subscription_type: "channel.chat.message" },
      payload: {
        subscription: {
          condition: { broadcaster_user_id: "100", user_id: "100" },
          transport: { session_id: sessionId },
        },
        event: {
          chatter_user_id: "200",
          chatter_user_login: "streamer",
          message: { text: "!claim" },
        },
      },
    })
  })

  test("does not deliver chat messages of another broadcaster", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    await subscribe(tokens.access_token, sessionId, "100", "100")

    fake.control.sendChatMessage("200", "100", "hello")
    fake.control.sendChatMessage("100", "200", "marker")
    const message = await socket.nextOfType("notification")

    expect(message).toMatchObject({ payload: { event: { message: { text: "marker" } } } })
  })

  test("closes a socket that sends no subscription within the window", async () => {
    const socket = await openSocket()
    await socket.next()

    const closed = await socket.closed

    expect(closed.code).toBe(4003)
  })

  test("keeps a subscribed socket open past the window and sends keepalives", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    await subscribe(tokens.access_token, sessionId, "100", "100")

    const keepalive = await socket.nextOfType("session_keepalive")
    await Bun.sleep(options.subscribeWindowMs + 100)

    expect(keepalive.metadata.message_type).toBe("session_keepalive")
    expect(socket.ws.readyState).toBe(WebSocket.OPEN)
  })

  test("rejects a subscription for an unknown session, another user's identity or a missing scope", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const chatTokens = await signIn("user:read:chat")
    const otherTokens = await signIn("openid")

    const unknownSession = await subscribe(chatTokens.access_token, "nope", "100", "100")
    const otherUser = await subscribe(chatTokens.access_token, sessionId, "100", "200")
    const noScope = await subscribe(otherTokens.access_token, sessionId, "100", "100")
    const badBody = await fetch(url("/helix/eventsub/subscriptions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chatTokens.access_token}`,
        "Client-Id": options.clientId,
      },
      body: "not json",
    })

    expect([unknownSession.status, otherUser.status, noScope.status, badBody.status]).toEqual([
      400, 403, 403, 400,
    ])
  })

  test("answers a scripted 503 on the subscription endpoint", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    fake.control.failNext("eventsub", 503, 1)

    const response = await subscribe(tokens.access_token, sessionId, "100", "100")

    expect(response.status).toBe(503)
  })

  test("revoking sends a revocation per chat subscription and drops it", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    await subscribe(tokens.access_token, sessionId, "100", "100")

    fake.control.revokeChatSubscriptions()
    const revocation = await socket.nextOfType("revocation")

    expect(revocation).toMatchObject({
      metadata: { subscription_type: "channel.chat.message" },
      payload: { subscription: { status: "authorization_revoked" } },
    })
    expect(fake.control.eventSubSubscriptions()).toBe(0)
    expect(socket.ws.readyState).toBe(WebSocket.OPEN)
  })

  test("counts the open sockets and the chat subscriptions on them", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    const before = [fake.control.eventSubConnections(), fake.control.eventSubSubscriptions()]

    await subscribe(tokens.access_token, sessionId, "100", "100")
    const subscribed = [fake.control.eventSubConnections(), fake.control.eventSubSubscriptions()]
    socket.ws.close()
    await socket.closed
    for (let wait = 0; wait < 50 && fake.control.eventSubConnections() > 0; wait++) {
      await Bun.sleep(20)
    }

    expect(before).toEqual([1, 0])
    expect(subscribed).toEqual([1, 1])
    expect([fake.control.eventSubConnections(), fake.control.eventSubSubscriptions()]).toEqual([
      0, 0,
    ])
  })

  test("reconnect sends session_reconnect and a socket opened on its URL keeps the session and subscriptions", async () => {
    const socket = await openSocket()
    const sessionId = await welcomedSessionId(socket)
    const tokens = await signIn("user:read:chat")
    await subscribe(tokens.access_token, sessionId, "100", "100")

    fake.control.reconnect()
    const reconnect = await socket.nextOfType("session_reconnect")
    const reconnectUrl = reconnect.payload.session?.reconnect_url ?? ""
    const next = await openSocket(reconnectUrl)
    const welcome = await next.next()
    fake.control.sendChatMessage("100", "200", "after reconnect")
    const message = await next.nextOfType("notification")

    expect(welcome.metadata.message_type).toBe("session_welcome")
    expect(welcome.payload.session?.id).toBe(sessionId)
    expect(message).toMatchObject({ payload: { event: { message: { text: "after reconnect" } } } })
  })
})

function url(path: string): URL {
  return new URL(path, fake.server.url)
}

async function authorize(scope: string, nonce?: string, state?: string): Promise<Response> {
  const query = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope,
  })
  if (nonce !== undefined) query.set("nonce", nonce)
  if (state !== undefined) query.set("state", state)
  return fetch(url(`/oauth2/authorize?${query}`), { redirect: "manual" })
}

function hintQuery(hint: string): URLSearchParams {
  return new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid",
    login_hint: hint,
  })
}

async function authorizeWithHint(hint: string): Promise<string> {
  const response = await fetch(url(`/oauth2/authorize?${hintQuery(hint)}`), { redirect: "manual" })
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code")
  if (code === null) throw new Error("authorize returned no code")
  return code
}

async function authorizeCode(scope: string, nonce?: string): Promise<string> {
  const response = await authorize(scope, nonce)
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code")
  if (code === null) throw new Error("authorize returned no code")
  return code
}

async function postToken(form: Record<string, string>): Promise<Response> {
  return fetch(url("/oauth2/token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      ...form,
    }),
  })
}

async function exchangeCode(code: string, clientSecret = options.clientSecret): Promise<Response> {
  return postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_secret: clientSecret,
  })
}

async function refresh(refreshToken: string): Promise<Response> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken })
}

async function signIn(scope: string, nonce?: string): Promise<TokenResponse> {
  const response = await exchangeCode(await authorizeCode(scope, nonce))
  const tokens: TokenResponse = await response.json()
  return tokens
}

async function validate(accessToken: string): Promise<Response> {
  return fetch(url("/oauth2/validate"), { headers: { Authorization: `OAuth ${accessToken}` } })
}

async function helix(path: string, accessToken: string): Promise<Response> {
  return fetch(url(path), {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": options.clientId },
  })
}

async function listIds(
  path: string,
  accessToken: string,
): Promise<{ ids: string[]; cursor: string | undefined }> {
  const body: { data: { user_id: string }[]; pagination: { cursor?: string } } = await (
    await helix(path, accessToken)
  ).json()
  return { ids: body.data.map((entry) => entry.user_id), cursor: body.pagination.cursor }
}

async function subscribe(
  accessToken: string,
  sessionId: string,
  broadcasterId: string,
  userId: string,
): Promise<Response> {
  return fetch(url("/helix/eventsub/subscriptions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": options.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: userId },
      transport: { method: "websocket", session_id: sessionId },
    }),
  })
}

interface TestSocket {
  ws: WebSocket
  closed: Promise<CloseEvent>
  next(): Promise<SocketMessage>
  nextOfType(type: string): Promise<SocketMessage>
}

/** Resolves once the socket is open; messages that arrive meanwhile are queued for `next`. */
async function openSocket(
  address = `ws://${fake.server.hostname}:${fake.server.port}/eventsub/ws`,
): Promise<TestSocket> {
  const ws = new WebSocket(address)
  sockets.push(ws)
  const queue: SocketMessage[] = []
  const waiting: ((message: SocketMessage) => void)[] = []
  ws.addEventListener("message", (event) => {
    const message: SocketMessage = JSON.parse(String(event.data))
    const waiter = waiting.shift()
    if (waiter === undefined) queue.push(message)
    else waiter(message)
  })
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve))
  await new Promise((resolve) => ws.addEventListener("open", resolve))

  const next = (): Promise<SocketMessage> => {
    const queued = queue.shift()
    return queued === undefined
      ? new Promise((resolve) => waiting.push(resolve))
      : Promise.resolve(queued)
  }
  const nextOfType = async (type: string): Promise<SocketMessage> => {
    for (;;) {
      const message = await next()
      if (message.metadata.message_type === type) return message
    }
  }
  return { ws, closed, next, nextOfType }
}

async function welcomedSessionId(socket: TestSocket): Promise<string> {
  const welcome = await socket.next()
  const id = welcome.payload.session?.id
  if (id === undefined) throw new Error("first message was not a welcome")
  return id
}
