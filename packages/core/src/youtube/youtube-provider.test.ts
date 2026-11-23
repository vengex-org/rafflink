import { beforeEach, describe, expect, it } from "bun:test"
import {
  streamerTokens,
  unitsToday,
  youtubeStreamer,
  youtubeWorld,
  type YouTubeWorld,
} from "../../test/youtube-fixture.ts"
import { PlatformNoChannel } from "../platform/errors.ts"
import { YouTubeQuotaExhausted } from "./errors.ts"

let world: YouTubeWorld

beforeEach(() => {
  world = youtubeWorld()
})

describe("YouTubeProvider", () => {
  it("asks Google for offline access with forced consent and the channel picker, read-only", () => {
    const url = new URL(
      world.provider.authorizeUrl({
        state: "s",
        nonce: "n",
        scopes: world.provider.scopes.streamer,
        redirectUri: "http://localhost/auth/youtube/callback",
        codeChallenge: "c",
      }),
    )

    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "select_account consent",
      code_challenge_method: "S256",
    })
  })

  it("signs the streamer in as their channel, named by its handle, for one unit", async () => {
    const tokens = await streamerTokens(world, youtubeStreamer)

    const userId = await world.provider.verifySignIn({
      ...tokens,
      expiresInSeconds: 1,
      idToken: null,
    })
    const profile = await world.provider.userProfile(tokens.accessToken)

    expect(userId).toBe(youtubeStreamer.id)
    expect(profile).toEqual({
      id: youtubeStreamer.id,
      login: "yt_streamer",
      displayName: "YouTube Streamer",
      createdAt: null,
      profileImageUrl: null,
    })
    expect(await unitsToday(world)).toBe(2)
  })

  it("names a channel without a handle by its id", async () => {
    world.fake.control.addChannel({
      id: "UCnohandle00000000000000",
      title: "No Handle",
      handle: null,
    })
    const tokens = await streamerTokens(world, {
      id: "UCnohandle00000000000000",
      title: "No Handle",
      handle: null,
    })

    expect((await world.provider.userProfile(tokens.accessToken)).login).toBe(
      "ucnohandle00000000000000",
    )
  })

  it("refuses an account that owns no channel", async () => {
    const tokens = await streamerTokens(world, null)

    const refused = world.provider.verifySignIn({ ...tokens, expiresInSeconds: 1, idToken: null })

    expect(refused).rejects.toBeInstanceOf(PlatformNoChannel)
  })

  it("keeps the refresh token Google does not send again on a refresh", async () => {
    const tokens = await streamerTokens(world, youtubeStreamer)

    const refreshed = await world.provider.refreshTokens(tokens.refreshToken)

    expect(refreshed.refreshToken).toBe(tokens.refreshToken)
    expect(refreshed.accessToken).not.toBe(tokens.accessToken)
  })

  it("validates a token without spending units and finds a revoked one invalid", async () => {
    const tokens = await streamerTokens(world, youtubeStreamer)

    const before = await world.provider.validate(tokens.accessToken)
    world.fake.control.revokeTokens(youtubeStreamer.id)
    const after = await world.provider.validate(tokens.accessToken)

    expect(before).toEqual({ status: "valid", userId: null })
    expect(after).toEqual({ status: "invalid" })
    expect(await unitsToday(world)).toBe(0)
  })

  it("sends no call once the day's units are spent", async () => {
    world = youtubeWorld({ YOUTUBE_DAILY_QUOTA_UNITS: "1" })
    const tokens = await streamerTokens(world, youtubeStreamer)
    await world.provider.userProfile(tokens.accessToken)
    const channelCalls = () =>
      world.fake.control.calls.filter((call) => call.path === "/youtube/v3/channels").length

    const refused = world.provider.userProfile(tokens.accessToken)

    expect(refused).rejects.toBeInstanceOf(YouTubeQuotaExhausted)
    await refused.catch(() => {})
    expect(channelCalls()).toBe(1)
  })

  it("reads chat handles as logins and refuses text that cannot be one", () => {
    expect(world.provider.parseLogin(" @Some.Name-1 ")).toBe("some.name-1")
    expect(world.provider.parseLogin("ab")).toBeNull()
    expect(world.provider.parseLogin("two words")).toBeNull()
  })
})
