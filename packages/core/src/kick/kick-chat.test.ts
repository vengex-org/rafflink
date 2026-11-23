import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  kickStreamer,
  kickViewer,
  kickWorld,
  userTokens,
  type KickWorld,
} from "../../test/kick-fixture.ts"
import type {
  ChannelEntryRefusal,
  ChatListener,
  ChatSource,
  WatchTopics,
} from "../platform/chat-source.ts"
import type { StreamerAccess } from "../platform/provider.ts"
import { kickChat } from "./kick-chat.ts"

let world: KickWorld
let access: StreamerAccess
let unavailable: unknown[]
let entryUnavailable: ChannelEntryRefusal[]
let scheduled: number
let topics: WatchTopics

beforeEach(async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  world = kickWorld({ KICK_SUBSCRIBE_MAX_ATTEMPTS: "2", KICK_SUBSCRIBE_RETRY_DELAY_SECONDS: "5" })
  const { accessToken } = await userTokens(world, kickStreamer, ["user:read", "events:subscribe"])
  access = { accessToken, broadcasterId: kickStreamer.id }
  unavailable = []
  entryUnavailable = []
  scheduled = 0
  topics = { chat: true, subscriptions: false, pointsRewardId: null }
})

const listener: ChatListener = {
  onMessage: () => {},
  onChannelEntry: () => {},
  onChannelEntryUnavailable: (refusal) => entryUnavailable.push(refusal),
  topics: () => topics,
  onUnavailable: (cause) => unavailable.push(cause),
  onSchedule: () => {
    scheduled += 1
  },
}

function source(giveawayId: string): ChatSource {
  return kickChat({
    giveawayId,
    client: world.client,
    watches: world.watches,
    clock: world.clock,
    config: world.config,
    streamerAccess: async () => access,
  })(listener)
}

/** Lets the source's chain of table and Kick calls run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Bun.sleep(0)
}

function watchRows(): { giveaway_id: string; chatter_ids: string | null }[] {
  return world.db
    .query<{ giveaway_id: string; chatter_ids: string | null }, []>(
      "SELECT giveaway_id, chatter_ids FROM kick_chat_watches ORDER BY giveaway_id",
    )
    .all()
}

const winners = { kind: "chatters", userIds: [kickViewer.id] } as const

describe("kickChat", () => {
  it("records the watch with its chatters and subscribes the channel's chat once", async () => {
    const chat = source("g1")

    chat.open(winners)
    await settle()

    expect(watchRows()).toEqual([{ giveaway_id: "g1", chatter_ids: `["${kickViewer.id}"]` }])
    expect(world.fake.control.subscriptions()).toMatchObject([
      { broadcasterId: kickStreamer.id, event: "chat.message.sent", version: 1 },
    ])
  })

  it("writes a changed audience and leaves an unchanged one alone", async () => {
    const chat = source("g1")
    chat.open(winners)
    await settle()
    const writesBefore = world.db.query("SELECT updated_at FROM kick_chat_watches").get()

    chat.open(winners)
    await settle()
    const unchanged = world.db.query("SELECT updated_at FROM kick_chat_watches").get()
    world.clock.advance(1000)
    chat.open({ kind: "chatters", userIds: [] })
    await settle()

    expect(unchanged).toEqual(writesBefore)
    expect(watchRows()).toEqual([{ giveaway_id: "g1", chatter_ids: "[]" }])
  })

  it("shares one subscription between two rooms of the channel and removes it with the last watch", async () => {
    const first = source("g1")
    const second = source("g2")
    first.open(winners)
    await settle()
    second.open(winners)
    await settle()

    first.close()
    await settle()
    const afterFirst = world.fake.control.subscriptions().length
    second.close()
    await settle()

    expect(afterFirst).toBe(1)
    expect(world.fake.control.subscriptions()).toEqual([])
    expect(watchRows()).toEqual([])
  })

  it("removes the watch an earlier source of the room left, when a fresh source closes", async () => {
    source("g1").open(winners)
    await settle()

    source("g1").close()
    await settle()

    expect(watchRows()).toEqual([])
    expect(world.fake.control.subscriptions()).toEqual([])
  })

  it("does nothing on a second close", async () => {
    const chat = source("g1")
    chat.open(winners)
    await settle()
    chat.close()
    await settle()
    source("g1").open(winners)
    await settle()

    chat.close()
    await settle()

    expect(watchRows()).toHaveLength(1)
  })

  it("retries a failed subscribe at its wake time and gives up after the last attempt", async () => {
    world.fake.control.failNext("subscribe", 500, 2)
    const chat = source("g1")

    chat.open(winners)
    await settle()
    const retryAt = chat.wakeAt()
    world.clock.advance(5000)
    chat.onAlarm()
    await settle()

    expect(scheduled).toBe(1)
    expect(retryAt).toBe(world.clock.now())
    expect(unavailable).toHaveLength(1)
    expect(chat.wakeAt()).toBeNull()
    expect(watchRows()).toEqual([])
  })

  it("subscribes on the retry after one failed attempt", async () => {
    world.fake.control.failNext("subscribe", 503, 1)
    const chat = source("g1")
    chat.open(winners)
    await settle()

    world.clock.advance(5000)
    chat.onAlarm()
    await settle()

    expect(unavailable).toEqual([])
    expect(world.fake.control.subscriptions()).toHaveLength(1)
  })

  it("gives up at once when Kick refuses the subscription for good", async () => {
    world.fake.control.failNext("subscribe", 400, 1)
    const chat = source("g1")

    chat.open(winners)
    await settle()

    expect(scheduled).toBe(0)
    expect(unavailable).toHaveLength(1)
    expect(watchRows()).toEqual([])
  })

  it("waits twice as long after each 429", async () => {
    world = kickWorld({ KICK_SUBSCRIBE_MAX_ATTEMPTS: "3", KICK_SUBSCRIBE_RETRY_DELAY_SECONDS: "5" })
    world.fake.control.failNext("subscribe", 429, 2)
    const chat = source("g1")
    const start = world.clock.now()

    chat.open(winners)
    await settle()
    const firstRetry = chat.wakeAt()
    world.clock.advance(5000)
    chat.onAlarm()
    await settle()
    const secondRetry = chat.wakeAt()

    expect([firstRetry, secondRetry]).toEqual([start + 5000, start + 15_000])
  })

  it("subscribes again when Kick dropped the stored subscription", async () => {
    source("g1").open(winners)
    await settle()
    world.fake.control.dropSubscriptions()

    source("g2").open(winners)
    await settle()

    const [live] = world.fake.control.subscriptions()
    expect(live).toBeDefined()
    expect(await world.watches.subscriptionsOf(kickStreamer.id)).toEqual([
      { event: "chat.message.sent", subscriptionId: live?.id ?? "" },
    ])
  })

  it("still closes after a failed watch write broke one step of the chain", async () => {
    const chat = source("g1")
    chat.open(winners)
    await settle()
    const watch = spyOn(world.watches, "watch").mockRejectedValueOnce(new Error("D1 down"))

    chat.open({ kind: "chatters", userIds: [] })
    await settle()
    chat.close()
    await settle()

    expect(watch).toHaveBeenCalledTimes(1)
    expect(watchRows()).toEqual([])
    expect(world.fake.control.subscriptions()).toEqual([])
  })

  it("keeps the subscription's record while Kick does not delete it, so the webhook route can cancel it", async () => {
    const chat = source("g1")
    chat.open(winners)
    await settle()
    world.fake.control.failNext("unsubscribe", 503, 1)

    chat.close()
    await settle()

    expect(watchRows()).toEqual([])
    expect(world.fake.control.subscriptions()).toHaveLength(1)
    expect(await world.watches.subscriptionsOf(kickStreamer.id)).toEqual([
      {
        event: "chat.message.sent",
        subscriptionId: world.fake.control.subscriptions()[0]?.id ?? "",
      },
    ])
  })

  it("records the keyword and subscribes the sub and redemption events the topics ask for", async () => {
    topics = { chat: true, subscriptions: true, pointsRewardId: "reward-1" }
    const chat = source("g1")

    chat.open({ kind: "keyword", keyword: "!enter" })
    await settle()

    expect(interestRows()).toEqual([
      {
        giveaway_id: "g1",
        chatter_ids: "[]",
        keyword: "!enter",
        sub_entry: 1,
        reward_id: "reward-1",
      },
    ])
    expect(subscribedEvents()).toEqual([
      "channel.reward.redemption.updated",
      "channel.subscription.gifts",
      "channel.subscription.new",
      "channel.subscription.renewal",
      "chat.message.sent",
    ])
  })

  it("drops the sub and redemption subscriptions once no watch reads them, and keeps chat", async () => {
    topics = { chat: true, subscriptions: true, pointsRewardId: "reward-1" }
    const chat = source("g1")
    chat.open({ kind: "keyword", keyword: "!enter" })
    await settle()

    topics = { chat: true, subscriptions: false, pointsRewardId: null }
    chat.open(winners)
    await settle()

    expect(subscribedEvents()).toEqual(["chat.message.sent"])
    expect(interestRows()).toEqual([
      {
        giveaway_id: "g1",
        chatter_ids: `["${kickViewer.id}"]`,
        keyword: null,
        sub_entry: 0,
        reward_id: null,
      },
    ])
  })

  it("subscribes no chat for a watch that reads only subs", async () => {
    topics = { chat: false, subscriptions: true, pointsRewardId: null }
    const chat = source("g1")

    chat.open({ kind: "chatters", userIds: [] })
    await settle()

    expect(subscribedEvents()).toEqual([
      "channel.subscription.gifts",
      "channel.subscription.new",
      "channel.subscription.renewal",
    ])
  })

  it("keeps the sub subscriptions while another room of the channel still reads them", async () => {
    topics = { chat: true, subscriptions: true, pointsRewardId: null }
    const first = source("g1")
    first.open({ kind: "keyword", keyword: "!enter" })
    await settle()
    const second = source("g2")
    second.open({ kind: "keyword", keyword: "!join" })
    await settle()

    first.close()
    await settle()

    expect(subscribedEvents()).toEqual([
      "channel.subscription.gifts",
      "channel.subscription.new",
      "channel.subscription.renewal",
      "chat.message.sent",
    ])
  })

  it("goes on with chat and subs when Kick refuses only the redemption event", async () => {
    topics = { chat: true, subscriptions: true, pointsRewardId: "reward-1" }
    world.fake.control.refuseEvent("channel.reward.redemption.updated", "scope missing")
    const chat = source("g1")

    chat.open({ kind: "keyword", keyword: "!enter" })
    await settle()

    expect(entryUnavailable.map((refusal) => refusal.via)).toEqual(["points"])
    expect(unavailable).toEqual([])
    expect(subscribedEvents()).toEqual([
      "channel.subscription.gifts",
      "channel.subscription.new",
      "channel.subscription.renewal",
      "chat.message.sent",
    ])
    expect(interestRows()[0]).toMatchObject({ keyword: "!enter", sub_entry: 1, reward_id: null })
  })

  it("goes on with chat and points when Kick refuses the sub events, and reports subs once", async () => {
    topics = { chat: true, subscriptions: true, pointsRewardId: "reward-1" }
    world.fake.control.refuseEvent("channel.subscription.new", "scope missing")
    world.fake.control.refuseEvent("channel.subscription.renewal", "scope missing")
    const chat = source("g1")

    chat.open({ kind: "keyword", keyword: "!enter" })
    await settle()

    expect(entryUnavailable.map((refusal) => refusal.via)).toEqual(["sub"])
    expect(subscribedEvents()).toEqual(["channel.reward.redemption.updated", "chat.message.sent"])
    expect(interestRows()[0]).toMatchObject({
      keyword: "!enter",
      sub_entry: 0,
      reward_id: "reward-1",
    })
  })

  it("gives up when Kick refuses the chat event", async () => {
    world.fake.control.refuseEvent("chat.message.sent", "not allowed")
    const chat = source("g1")

    chat.open(winners)
    await settle()

    expect(unavailable).toHaveLength(1)
    expect(watchRows()).toEqual([])
  })
})

interface InterestRow {
  giveaway_id: string
  chatter_ids: string | null
  keyword: string | null
  sub_entry: number
  reward_id: string | null
}

function interestRows(): InterestRow[] {
  return world.db
    .query<InterestRow, []>(
      "SELECT giveaway_id, chatter_ids, keyword, sub_entry, reward_id FROM kick_chat_watches ORDER BY giveaway_id",
    )
    .all()
}

function subscribedEvents(): string[] {
  return world.fake.control
    .subscriptions()
    .map((subscription) => subscription.event)
    .toSorted()
}
