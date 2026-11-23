import { beforeEach, describe, expect, it } from "bun:test"
import {
  kickStreamer,
  kickViewer,
  kickWorld,
  userTokens,
  type KickWorld,
} from "../../test/kick-fixture.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import { kickPlatform, KickProvider } from "./kick-provider.ts"

let world: KickWorld
let provider: KickProvider

beforeEach(() => {
  world = kickWorld()
  provider = new KickProvider(world.client, world.watches, world.clock, world.config)
})

describe("KickProvider", () => {
  it("asks for PKCE with S256 on the authorize URL", () => {
    const url = new URL(
      provider.authorizeUrl({
        state: "s",
        nonce: "n",
        scopes: provider.scopes.streamer,
        redirectUri: "http://localhost/auth/kick/streamer",
        codeChallenge: "challenge",
      }),
    )

    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "kick-client",
      response_type: "code",
      redirect_uri: "http://localhost/auth/kick/streamer",
      state: "s",
      scope: "user:read events:subscribe",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    })
  })

  it("proves the user of the exchanged token and reads the username as login and display name", async () => {
    const tokens = await userTokens(world, kickViewer, provider.scopes.viewer)

    const userId = await provider.verifySignIn({
      ...tokens,
      expiresInSeconds: 60,
      idToken: null,
      scopes: null,
    })
    const profile = await provider.userProfile(tokens.accessToken)

    expect(userId).toBe(kickViewer.id)
    expect(profile).toEqual({
      id: kickViewer.id,
      login: "kick_viewer",
      displayName: "Kick_Viewer",
      createdAt: null,
      profileImageUrl: null,
    })
  })

  it("calls a revoked token invalid and a working one valid", async () => {
    const tokens = await userTokens(world, kickStreamer, provider.scopes.streamer)

    const before = await provider.validate(tokens.accessToken)
    world.fake.control.revokeUserTokens(kickStreamer.id)
    const after = await provider.validate(tokens.accessToken)

    expect(before).toEqual({ status: "valid" })
    expect(after).toEqual({ status: "invalid" })
  })

  it("calls the token unavailable while Kick fails", async () => {
    const tokens = await userTokens(world, kickStreamer, provider.scopes.streamer)
    world.fake.control.failNext("users", 503, 1)

    expect(await provider.validate(tokens.accessToken)).toEqual({ status: "unavailable" })
  })

  it("reads a typed login in lower case and refuses text that cannot be a Kick username", () => {
    expect(provider.parseLogin(" @Kick_Viewer ")).toBe("kick_viewer")
    for (const text of [
      "",
      " ",
      "ab",
      "a".repeat(26),
      "kick-viewer",
      "kick viewer",
      "constructor!",
    ]) {
      expect(provider.parseLogin(text)).toBeNull()
    }
  })

  it("finds an account by its channel slug and answers null for an unknown one", async () => {
    expect(await provider.accountByLogin("kick_streamer")).toEqual({
      id: kickStreamer.id,
      login: "kick_streamer",
    })
    expect(await provider.accountByLogin("nobody_here")).toBeNull()
  })

  it("lists the enabled rewards of the streamer's channel with channel:rewards:read", async () => {
    world.fake.control.setRewards(kickStreamer.id, [
      { id: "01HREWARD0001", title: "Enter the giveaway", cost: 500, enabled: true },
      { id: "01HREWARD0002", title: "Retired", cost: 100, enabled: false },
    ])
    const tokens = await userTokens(world, kickStreamer, [
      ...provider.scopes.streamer,
      ...provider.featureScopes.redemptions,
    ])

    expect(await provider.pointsRewards(tokens.accessToken)).toEqual([
      { id: "01HREWARD0001", title: "Enter the giveaway" },
    ])
  })
})

describe("kickPlatform", () => {
  it("has no Kick provider without a Kick app", () => {
    const config = { ...world.config, kickClientId: null, kickClientSecret: null }

    expect(kickPlatform(config, fetch, world.clock, new BunSqliteAsyncSql(world.db))).toEqual({})
  })
})
