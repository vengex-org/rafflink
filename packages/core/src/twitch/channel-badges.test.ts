import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  createFakeTwitch,
  globalSubscriberBadgeUrl,
  profileImageUrlOf,
  websocket,
  type FakeTwitch,
} from "@rafflink/fake-twitch"
import { resolveConfig, type ResolvedConfig } from "../config.ts"
import { ChannelBadges } from "./channel-badges.ts"
import { TwitchClient } from "./twitch-client.ts"

const streamer = {
  id: "200",
  login: "streamer",
  displayName: "Streamer",
  createdAt: "2019-01-01T00:00:00Z",
  profileImageUrl: profileImageUrlOf("streamer"),
}
const t1 = "https://static-cdn.jtvnw.net/badges/v1/t1/2"
const t2 = "https://static-cdn.jtvnw.net/badges/v1/t2/2"
const t3 = "https://static-cdn.jtvnw.net/badges/v1/t3/2"

let fake: FakeTwitch
let server: ReturnType<typeof Bun.serve>
let now: number
let badges: ChannelBadges
let config: ResolvedConfig

beforeEach(() => {
  fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: streamer,
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  server = Bun.serve({ port: 0, fetch: fake.app.fetch, websocket })
  config = resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: "key",
    SESSION_SECRET: "session",
    ADMIN_TWITCH_IDS: "1",
    PUBLIC_URL: "http://localhost",
    TWITCH_ID_BASE_URL: server.url.origin,
    TWITCH_HELIX_BASE_URL: server.url.origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
    CHANNEL_BADGES_TTL_SECONDS: "60",
  })
  now = 1_000_000
  badges = new ChannelBadges(new TwitchClient(config, fetch), { now: () => now }, config)
})

afterEach(async () => {
  mock.restore()
  await server.stop(true)
})

function helixCalls(): number {
  return fake.control.calls.filter((call) => call.path.startsWith("/helix/chat/badges")).length
}

describe("ChannelBadges", () => {
  it("returns the channel's own images and reads nothing else when it has all three", async () => {
    fake.control.setChannelSubscriberBadges("200", { "1000": t1, "2000": t2, "3000": t3 })

    expect(await badges.of("200")).toEqual({ sub_t1: t1, sub_t2: t2, sub_t3: t3 })
    expect(fake.control.calls.some((call) => call.path === "/helix/chat/badges/global")).toBe(false)
  })

  it("fills the tiers a channel has no badge for with the global badge", async () => {
    fake.control.setChannelSubscriberBadges("200", { "2000": t2 })

    expect(await badges.of("200")).toEqual({
      sub_t1: globalSubscriberBadgeUrl,
      sub_t2: t2,
      sub_t3: globalSubscriberBadgeUrl,
    })
  })

  it("asks Twitch once per channel inside the time to live, also for calls at once", async () => {
    fake.control.setChannelSubscriberBadges("200", { "1000": t1 })

    await Promise.all([badges.of("200"), badges.of("200")])
    await badges.of("200")

    expect(helixCalls()).toBe(2)
  })

  it("asks again once the time to live has passed", async () => {
    fake.control.setChannelSubscriberBadges("200", { "1000": t1 })
    await badges.of("200")

    now += 60_000
    fake.control.setChannelSubscriberBadges("200", { "1000": t2 })

    expect((await badges.of("200")).sub_t1).toBe(t2)
  })

  it("keeps channels apart", async () => {
    fake.control.addUser({ ...streamer, id: "201", login: "other" })
    fake.control.setChannelSubscriberBadges("200", { "1000": t1 })
    fake.control.setChannelSubscriberBadges("201", { "1000": t3 })

    expect((await badges.of("200")).sub_t1).toBe(t1)
    expect((await badges.of("201")).sub_t1).toBe(t3)
  })

  it("does not keep a failure that is not Twitch's and passes it on", async () => {
    let reads = 0
    const broken = new ChannelBadges(
      {
        appAccessToken: () => {
          reads += 1
          return Promise.reject(new TypeError("bug"))
        },
        channelSubscriberBadges: () => Promise.reject(new Error("not reached")),
        globalSubscriberBadge: () => Promise.reject(new Error("not reached")),
      },
      { now: () => now },
      config,
    )

    const first = await broken.of("200").catch((error: unknown) => error)
    const second = await broken.of("200").catch((error: unknown) => error)

    expect(first).toBeInstanceOf(TypeError)
    expect(second).toBeInstanceOf(TypeError)
    expect(reads).toBe(2)
  })

  it("answers no badges when Twitch fails and does not keep that answer", async () => {
    fake.control.setChannelSubscriberBadges("200", { "1000": t1, "2000": t2, "3000": t3 })
    fake.control.failNext("badges", 503, 2)
    const warned = spyOn(console, "warn").mockImplementation(() => {})

    const failed = await badges.of("200")
    const retried = await badges.of("200")

    expect(failed).toEqual({ sub_t1: null, sub_t2: null, sub_t3: null })
    expect(retried.sub_t1).toBe(t1)
    expect(warned).toHaveBeenCalledWith("channel badges unavailable", {
      broadcasterId: "200",
      errorClass: "TwitchUnavailable",
    })
  })
})
