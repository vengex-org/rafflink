import { beforeEach, describe, expect, it } from "bun:test"
import { createFakeYouTube, type FakeYouTube } from "../src/index.ts"

const streamer = { id: "UCstreamer0000000000000a", title: "Streamer", handle: "@streamer" }
const viewer = { id: "UCviewer000000000000000a", title: "Viewer", handle: "@viewer" }
const scope = "https://www.googleapis.com/auth/youtube.readonly"
const redirectUri = "http://localhost/auth/youtube/callback"
const verifier = "v".repeat(43)

let fake: FakeYouTube

beforeEach(() => {
  fake = createFakeYouTube({ clientId: "c", clientSecret: "s", defaultChannel: streamer })
  fake.control.addChannel(viewer)
})

async function challengeOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Buffer.from(digest).toString("base64url")
}

async function authorize(extra: Record<string, string>): Promise<string> {
  const query = new URLSearchParams({
    client_id: "c",
    response_type: "code",
    redirect_uri: redirectUri,
    state: "st",
    scope,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
    ...extra,
  })
  const response = await fake.app.request(`/o/oauth2/v2/auth?${query}`)
  return new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? ""
}

async function token(form: Record<string, string>): Promise<Response> {
  return fake.app.request("/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: "c", client_secret: "s", ...form }),
  })
}

async function signIn(): Promise<{ access_token: string; refresh_token?: string }> {
  const code = await authorize({ access_type: "offline", prompt: "select_account consent" })
  const response = await token({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
  return response.json()
}

async function api(path: string, accessToken: string): Promise<Response> {
  return fake.app.request(path, { headers: { Authorization: `Bearer ${accessToken}` } })
}

describe("fake YouTube", () => {
  it("refuses a consent request without an S256 challenge", async () => {
    const response = await fake.app.request(
      `/o/oauth2/v2/auth?client_id=c&response_type=code&redirect_uri=${redirectUri}&state=s&scope=${scope}`,
    )

    expect(response.status).toBe(400)
  })

  it("answers a refresh token only for an offline sign-in with forced consent", async () => {
    const online = await token({
      grant_type: "authorization_code",
      code: await authorize({}),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    const offline = await signIn()

    expect(await online.json()).not.toHaveProperty("refresh_token")
    expect(offline.refresh_token).toBeString()
  })

  it("keeps the refresh token on a refresh and answers none", async () => {
    const { refresh_token: refreshToken = "" } = await signIn()

    const first = await (
      await token({ grant_type: "refresh_token", refresh_token: refreshToken })
    ).json()
    const second = await token({ grant_type: "refresh_token", refresh_token: refreshToken })

    expect(first).not.toHaveProperty("refresh_token")
    expect(second.status).toBe(200)
  })

  it("answers the signed-in channel, and no items for an account without one", async () => {
    const { access_token: withChannel } = await signIn()
    fake.control.signInAs(null)
    const { access_token: without } = await signIn()

    const mine = await (
      await api("/youtube/v3/channels?part=id,snippet&mine=true", withChannel)
    ).json()
    const none = await (await api("/youtube/v3/channels?part=id,snippet&mine=true", without)).json()

    expect(mine.items).toEqual([
      {
        kind: "youtube#channel",
        id: streamer.id,
        snippet: { title: "Streamer", customUrl: "@streamer" },
      },
    ])
    expect(none).not.toHaveProperty("items")
  })

  it("lists the active broadcast's chat only with the broadcastStatus filter alone", async () => {
    const { access_token: accessToken } = await signIn()
    const chatId = fake.control.goLive(streamer.id)

    const both = await api(
      "/youtube/v3/liveBroadcasts?part=snippet&mine=true&broadcastStatus=active",
      accessToken,
    )
    const active = await (
      await api("/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active", accessToken)
    ).json()

    expect(both.status).toBe(400)
    expect(active.items[0].snippet.liveChatId).toBe(chatId)
  })

  it("pages a live chat from the page token on and refuses it once the broadcast ended", async () => {
    const { access_token: accessToken } = await signIn()
    const chatId = fake.control.goLive(streamer.id)
    fake.control.sendChatMessage(streamer.id, viewer.id, "first")
    const path = `/youtube/v3/liveChat/messages?liveChatId=${chatId}&part=snippet,authorDetails`

    const firstPage = await (await api(path, accessToken)).json()
    fake.control.sendChatMessage(streamer.id, viewer.id, "second", { member: true })
    const nextPage = await (
      await api(`${path}&pageToken=${firstPage.nextPageToken}`, accessToken)
    ).json()
    fake.control.endBroadcast(streamer.id)
    const ended = await api(path, accessToken)

    expect(
      firstPage.items.map(
        (item: { snippet: { displayMessage: string } }) => item.snippet.displayMessage,
      ),
    ).toEqual(["first"])
    expect(nextPage.items).toHaveLength(1)
    expect(nextPage.items[0].authorDetails).toMatchObject({
      displayName: "@viewer",
      isChatSponsor: true,
    })
    expect(ended.status).toBe(403)
    expect((await ended.json()).error.errors[0].reason).toBe("liveChatEnded")
  })

  it("refuses a revoked token's API calls and its refresh", async () => {
    const { access_token: accessToken, refresh_token: refreshToken = "" } = await signIn()

    fake.control.revokeTokens(streamer.id)

    expect((await api("/youtube/v3/channels?part=id&mine=true", accessToken)).status).toBe(401)
    expect((await token({ grant_type: "refresh_token", refresh_token: refreshToken })).status).toBe(
      400,
    )
    expect((await fake.app.request(`/tokeninfo?access_token=${accessToken}`)).status).toBe(400)
  })
})
