import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  kickStreamer,
  kickViewer,
  kickWorld,
  userTokens,
  type KickWorld,
} from "../../test/kick-fixture.ts"
import type { ChatListener, ChatSource } from "../platform/chat-source.ts"
import type { StreamerAccess } from "../platform/provider.ts"
import { kickChat } from "./kick-chat.ts"

let world: KickWorld
let access: StreamerAccess
let unavailable: unknown[]
let scheduled: number

beforeEach(async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  world = kickWorld({ KICK_SUBSCRIBE_MAX_ATTEMPTS: "2", KICK_SUBSCRIBE_RETRY_DELAY_SECONDS: "5" })
  const { accessToken } = await userTokens(world, kickStreamer, ["user:read", "events:subscribe"])
  access = { accessToken, broadcasterId: kickStreamer.id }
  unavailable = []
  scheduled = 0
})

const listener: ChatListener = {
  onMessage: () => {},
  onChannelEntry: () => {},
  onChannelEntryUnavailable: () => {},
  topics: () => ({ chat: true, subscriptions: false, pointsRewardId: null }),
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
    expect(await world.watches.subscriptionOf(kickStreamer.id)).toBe(live?.id ?? "")
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
    expect(await world.watches.subscriptionOf(kickStreamer.id)).toBe(
      world.fake.control.subscriptions()[0]?.id ?? "",
    )
  })
})
