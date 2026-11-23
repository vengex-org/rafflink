import { Database } from "bun:sqlite"
import {
  createFakeYouTube,
  type FakeYouTube,
  type FakeYouTubeChannel,
} from "@rafflink/fake-youtube"
import { resolveConfig, type ResolvedConfig } from "../src/config.ts"
import { BunSqliteAsyncSql } from "../src/sqlite-bun.ts"
import { YouTubeQuota } from "../src/youtube/quota.ts"
import { YouTubeClient } from "../src/youtube/youtube-client.ts"
import { YouTubeProvider } from "../src/youtube/youtube-provider.ts"
import { accountsSchema, TestClock } from "./app-fixture.ts"

export const youtubeStreamer: FakeYouTubeChannel = {
  id: "UCstreamer0000000000000a",
  title: "YouTube Streamer",
  handle: "@YT_Streamer",
}
export const youtubeViewer: FakeYouTubeChannel = {
  id: "UCviewer000000000000000a",
  title: "YouTube Viewer",
  handle: "@yt_viewer",
}
export const youtubeSecond: FakeYouTubeChannel = {
  id: "UCsecond000000000000000a",
  title: "Second Viewer",
  handle: "@yt_second",
}

export const youtubeScope = "https://www.googleapis.com/auth/youtube.readonly"

const app = { clientId: "yt-client", clientSecret: "yt-secret" } as const
const origin = "http://fake-youtube.test"

/** An in-process fake YouTube, a provider that reaches it without a socket, and the quota table over an empty accounts database. */
export interface YouTubeWorld {
  readonly fake: FakeYouTube
  readonly client: YouTubeClient
  readonly provider: YouTubeProvider
  readonly quota: YouTubeQuota
  readonly db: Database
  readonly clock: TestClock
  readonly config: ResolvedConfig
}

export function youtubeWorld(env: Readonly<Record<string, string>> = {}): YouTubeWorld {
  const fake = createFakeYouTube({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    defaultChannel: youtubeStreamer,
  })
  fake.control.addChannel(youtubeViewer)
  fake.control.addChannel(youtubeSecond)
  const config = resolveConfig({
    TWITCH_CLIENT_ID: "client",
    TWITCH_CLIENT_SECRET: "secret",
    TOKEN_SEAL_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
    SESSION_SECRET: "secret",
    ADMIN_TWITCH_IDS: "1",
    PUBLIC_URL: "http://localhost",
    YOUTUBE_CLIENT_ID: app.clientId,
    YOUTUBE_CLIENT_SECRET: app.clientSecret,
    YOUTUBE_AUTH_BASE_URL: origin,
    YOUTUBE_TOKEN_BASE_URL: origin,
    YOUTUBE_API_BASE_URL: origin,
    ...env,
  })
  const db = new Database(":memory:")
  db.exec(accountsSchema)
  const clock = new TestClock(Date.now())
  const quota = new YouTubeQuota(new BunSqliteAsyncSql(db), config)
  const client = new YouTubeClient(app, config, quota, clock, async (input, init) =>
    fake.app.fetch(new Request(input, init)),
  )
  return {
    fake,
    client,
    provider: new YouTubeProvider(client, quota, app, config),
    quota,
    db,
    clock,
    config,
  }
}

/** Tokens of `channel` through the fake's real consent and token endpoints, as the streamer sign-in gets them. */
export async function streamerTokens(
  world: YouTubeWorld,
  channel: FakeYouTubeChannel | null,
): Promise<{ readonly accessToken: string; readonly refreshToken: string }> {
  world.fake.control.signInAs(channel === null ? null : channel.id)
  const verifier = "v".repeat(43)
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url")
  const redirectUri = "http://localhost/auth/youtube/callback"
  const authorize = await world.fake.app.fetch(
    new Request(
      world.client.authorizeUrl({
        state: "s",
        scopes: [youtubeScope],
        redirectUri,
        codeChallenge: challenge,
      }),
    ),
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code") ?? ""
  return world.client.exchangeCode(code, redirectUri, verifier)
}

/** Units spent today, as the quota table holds them. */
export async function unitsToday(world: YouTubeWorld): Promise<number> {
  return (await world.quota.today(world.clock.now())).used
}
