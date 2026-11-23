import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  streamerTokens,
  unitsToday,
  youtubeSecond,
  youtubeStreamer,
  youtubeViewer,
  youtubeWorld,
  type YouTubeWorld,
} from "../../test/youtube-fixture.ts"
import type { ChatListener, ChatMessage, ChatSource } from "../platform/chat-source.ts"
import type { StreamerAccess } from "../platform/provider.ts"
import { youtubeChat } from "./youtube-chat.ts"

let world: YouTubeWorld
let access: StreamerAccess
let messages: ChatMessage[]
let unavailable: unknown[]
let scheduled: number

const keyword = { kind: "keyword", keyword: "!enter" } as const

beforeEach(async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  world = youtubeWorld({
    YOUTUBE_CHAT_MAX_ATTEMPTS: "2",
    YOUTUBE_CHAT_RETRY_DELAY_SECONDS: "5",
    YOUTUBE_BROADCAST_RETRY_SECONDS: "60",
  })
  await useWorld(world)
})

async function useWorld(next: YouTubeWorld): Promise<void> {
  world = next
  const { accessToken } = await streamerTokens(world, youtubeStreamer)
  access = { accessToken, broadcasterId: youtubeStreamer.id }
  messages = []
  unavailable = []
  scheduled = 0
}

const listener: ChatListener = {
  onMessage: (message) => messages.push(message),
  onChannelEntry: () => {},
  onChannelEntryUnavailable: () => {},
  topics: () => ({ chat: true, subscriptions: false, pointsRewardId: null }),
  onUnavailable: (cause) => unavailable.push(cause),
  onSchedule: () => {
    scheduled += 1
  },
}

function source(): ChatSource {
  return youtubeChat({
    giveawayId: "g1",
    client: world.client,
    clock: world.clock,
    config: world.config,
    streamerAccess: async () => access,
  })(listener)
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Bun.sleep(0)
}

/** Moves the clock to the source's next read and runs it. */
async function nextRead(chat: ChatSource): Promise<void> {
  const at = chat.wakeAt()
  if (at === null) throw new Error("the source has no read due")
  world.clock.advance(at - world.clock.now())
  chat.onAlarm()
  await settle()
}

function chatPageCalls(): number {
  return world.fake.control.calls.filter((call) => call.path === "/youtube/v3/liveChat/messages")
    .length
}

describe("youtubeChat", () => {
  it("reads the keyword messages written since it opened, with member and moderator roles", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.sendChatMessage(
      youtubeStreamer.id,
      youtubeViewer.id,
      "!enter",
      {},
      new Date(world.clock.now() - 1000),
    )
    const chat = source()

    chat.open(keyword)
    await settle()
    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeViewer.id, "!enter", {
      member: true,
    })
    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeSecond.id, "hello")
    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeSecond.id, "!ENTER now", {
      moderator: true,
    })
    world.clock.advance(1)
    await nextRead(chat)

    expect(messages).toEqual([
      {
        platformUserId: youtubeViewer.id,
        login: "yt_viewer",
        displayName: "@yt_viewer",
        text: "!enter",
        roles: { subTier: null, isMember: true, isVip: false, isModerator: false },
      },
      {
        platformUserId: youtubeSecond.id,
        login: "yt_second",
        displayName: "@yt_second",
        text: "!ENTER now",
        roles: { subTier: null, isMember: false, isVip: false, isModerator: true },
      },
    ])
  })

  it("reads only the winners' messages once the audience names chatters", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    const chat = source()
    chat.open({ kind: "chatters", userIds: [youtubeViewer.id] })
    await settle()

    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeSecond.id, "me!")
    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeViewer.id, "claiming")
    await nextRead(chat)

    expect(messages.map((message) => message.text)).toEqual(["claiming"])
  })

  it("waits the interval YouTube asks for, and no less than the configured least wait", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.setPollingInterval(8000)
    const chat = source()
    chat.open(keyword)
    await settle()
    const slow = (chat.wakeAt() ?? 0) - world.clock.now()

    world.fake.control.setPollingInterval(1000)
    await nextRead(chat)
    const fast = (chat.wakeAt() ?? 0) - world.clock.now()

    expect([slow, fast]).toEqual([8000, 5000])
    expect(scheduled).toBe(2)
  })

  it("does not read before its time and stops reading once closed", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    const chat = source()
    chat.open(keyword)
    await settle()

    chat.onAlarm()
    await settle()
    const early = chatPageCalls()
    chat.close()
    world.clock.advance(60_000)
    chat.onAlarm()
    await settle()

    expect(early).toBe(1)
    expect(chatPageCalls()).toBe(1)
    expect(chat.wakeAt()).toBeNull()
  })

  it("looks for a broadcast again later while the channel is not live, then reads its chat", async () => {
    const chat = source()
    chat.open(keyword)
    await settle()
    const wait = (chat.wakeAt() ?? 0) - world.clock.now()

    world.fake.control.goLive(youtubeStreamer.id)
    await nextRead(chat)

    expect(wait).toBe(60_000)
    expect(chatPageCalls()).toBe(1)
    expect(unavailable).toEqual([])
    expect(await unitsToday(world)).toBe(1 + 1 + 5)
  })

  it("finds the next broadcast after the chat it read ended", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    const chat = source()
    chat.open(keyword)
    await settle()

    world.fake.control.endBroadcast(youtubeStreamer.id)
    await nextRead(chat)
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.sendChatMessage(youtubeStreamer.id, youtubeViewer.id, "!enter")
    await nextRead(chat)

    expect(messages.map((message) => message.platformUserId)).toEqual([youtubeViewer.id])
    expect(unavailable).toEqual([])
  })

  it("retries a failed read and gives up after the last attempt", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.failNext("live-chat-messages", 503, 2)
    const chat = source()

    chat.open(keyword)
    await settle()
    const retryIn = (chat.wakeAt() ?? 0) - world.clock.now()
    await nextRead(chat)

    expect(retryIn).toBe(5000)
    expect(unavailable).toHaveLength(1)
    expect(chat.wakeAt()).toBeNull()
  })

  it("waits for Google's next quota day once the day's units are spent, and reads again then", async () => {
    await useWorld(youtubeWorld({ YOUTUBE_DAILY_QUOTA_UNITS: "6" }))
    world.clock.advance(Date.parse("2026-11-23T20:00:00Z") - world.clock.now())
    world.fake.control.goLive(youtubeStreamer.id)
    const chat = source()

    chat.open(keyword)
    await settle()
    await nextRead(chat)
    const waitUntil = chat.wakeAt()
    await nextRead(chat)

    expect(unavailable).toEqual([])
    // Midnight in Los Angeles is 08:00 UTC in November.
    expect(waitUntil).toBe(Date.parse("2026-11-24T08:00:00Z"))
    expect(chatPageCalls()).toBe(2)
  })

  it("reads winners no more often than the winner wait", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.setPollingInterval(1000)
    const chat = source()

    chat.open({ kind: "chatters", userIds: [youtubeViewer.id] })
    await settle()

    expect((chat.wakeAt() ?? 0) - world.clock.now()).toBe(30_000)
  })

  it("keeps the streamer's access between reads and fetches it again after YouTube rejects it", async () => {
    let fetched = 0
    world.fake.control.goLive(youtubeStreamer.id)
    const chat = youtubeChat({
      giveawayId: "g1",
      client: world.client,
      clock: world.clock,
      config: world.config,
      streamerAccess: async () => {
        fetched += 1
        return access
      },
    })(listener)

    chat.open(keyword)
    await settle()
    await nextRead(chat)
    const kept = fetched
    world.fake.control.failNext("live-chat-messages", 401, 1, "authError")
    await nextRead(chat)
    await nextRead(chat)

    expect(kept).toBe(1)
    expect(fetched).toBe(2)
    expect(unavailable).toEqual([])
  })

  it("gives up at once when YouTube refuses the token", async () => {
    world.fake.control.goLive(youtubeStreamer.id)
    world.fake.control.failNext("live-chat-messages", 403, 1, "insufficientPermissions")
    const chat = source()

    chat.open(keyword)
    await settle()

    expect(unavailable).toHaveLength(1)
  })
})
