import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { SignedWebhook } from "@rafflink/fake-kick"
import { kickStreamer, kickViewer, kickWorld, type KickWorld } from "../../test/kick-fixture.ts"
import type { ChatMessage } from "../platform/chat-source.ts"
import {
  KickOrphanSubscriptions,
  KickWebhookKey,
  parseChatEvent,
  receiveKickWebhook,
  type KickWebhookDeps,
} from "./webhook.ts"

const giveawayId = "g1"
const webhookUrl = "http://localhost/api/kick/webhook"

let world: KickWorld
let deps: KickWebhookDeps
let delivered: { giveawayId: string; message: ChatMessage }[]

beforeEach(async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  spyOn(console, "info").mockImplementation(() => {})
  world = kickWorld({ KICK_PUBLIC_KEY_REFRESH_SECONDS: "60", KICK_WEBHOOK_MAX_AGE_SECONDS: "300" })
  deps = {
    key: new KickWebhookKey(world.client, world.clock, world.config),
    orphans: new KickOrphanSubscriptions(world.client, world.watches, world.clock, world.config),
    watches: world.watches,
    clock: world.clock,
    config: world.config,
  }
  delivered = []
  world.fake.control.setWebhookUrl(webhookUrl)
  const subscriptionId = await world.client.subscribeChat(kickStreamer.id)
  await world.watches.saveSubscription(kickStreamer.id, subscriptionId, world.clock.now())
  await world.watches.watch(giveawayId, kickStreamer.id, [kickViewer.id], world.clock.now())
})

async function webhook(text = "claiming!", sentAt = new Date(world.clock.now())) {
  const signed = await world.fake.control.chatWebhook(kickStreamer.id, kickViewer.id, text, sentAt)
  if (signed === null) throw new Error("the fake sent no webhook")
  return signed
}

function receive(signed: SignedWebhook, changes: Partial<SignedWebhook> = {}): Promise<Response> {
  const { headers, body } = { ...signed, ...changes }
  return receiveKickWebhook(
    deps,
    new Request(webhookUrl, { method: "POST", headers, body }),
    async (id, message) => {
      delivered.push({ giveawayId: id, message })
    },
  )
}

function publicKeyReads(): number {
  return world.fake.control.calls.filter((call) => call.path === "/public/v1/public-key").length
}

function unsubscribeCalls(): number {
  return world.fake.control.calls.filter(
    (call) => call.method === "DELETE" && call.path === "/public/v1/events/subscriptions",
  ).length
}

/** Reads the key with a valid webhook and lets the refresh time pass, so a failed signature is refused at once. */
async function warmKey(): Promise<void> {
  expect((await receive(await webhook("warm"))).status).toBe(204)
  delivered = []
  world.clock.advance(60_000)
}

describe("receiveKickWebhook", () => {
  it("hands a signed chat message to the room that reads its sender", async () => {
    const response = await receive(await webhook("claiming!"))

    expect(response.status).toBe(204)
    expect(delivered).toEqual([
      {
        giveawayId,
        message: {
          platformUserId: kickViewer.id,
          login: "kick_viewer",
          displayName: "Kick_Viewer",
          text: "claiming!",
          roles: { subTier: null, isVip: false, isModerator: false },
        },
      },
    ])
  })

  it("refuses a body that was changed after Kick signed it", async () => {
    await warmKey()
    const signed = await webhook("claiming!")

    const response = await receive(signed, { body: signed.body.replace("claiming!", "forged!!!") })

    expect(response.status).toBe(401)
    expect(delivered).toEqual([])
  })

  it("refuses a signature header that is not base64", async () => {
    const signed = await webhook()

    const response = await receive(signed, {
      headers: { ...signed.headers, "Kick-Event-Signature": "%%%" },
    })

    expect(response.status).toBe(400)
    expect(delivered).toEqual([])
  })

  it("reads the key again after Kick rotated it and accepts the new signature", async () => {
    expect((await receive(await webhook("first"))).status).toBe(204)
    await world.fake.control.rotateKey()
    world.clock.advance(60_000)

    const response = await receive(await webhook("after the rotation"))

    expect(response.status).toBe(204)
    expect(delivered.map((entry) => entry.message.text)).toEqual(["first", "after the rotation"])
    expect(publicKeyReads()).toBe(2)
  })

  it("answers 503 for a failed signature sooner than the refresh time after the last read, so Kick sends it again", async () => {
    expect((await receive(await webhook("first"))).status).toBe(204)
    await world.fake.control.rotateKey()
    world.clock.advance(59_999)

    const response = await receive(await webhook("too soon"))

    expect(response.status).toBe(503)
    expect(publicKeyReads()).toBe(1)
  })

  it("does not read the key again sooner than the refresh time after a failed read", async () => {
    world.fake.control.failNext("public-key", 500, 1)

    const failed = await receive(await webhook("first"))
    const soon = await receive(await webhook("soon"))
    world.clock.advance(60_000)
    const later = await receive(await webhook("later"))

    expect([failed.status, soon.status, later.status]).toEqual([503, 503, 204])
    expect(publicKeyReads()).toBe(2)
  })

  it("refuses a body larger than 64 KiB before checking it", async () => {
    const signed = await webhook("x".repeat(70_000))

    const response = await receive(signed)

    expect(response.status).toBe(413)
    expect(publicKeyReads()).toBe(0)
  })

  it("cancels the subscription of a channel no room watches, once per retry time", async () => {
    await world.watches.unwatch(giveawayId)
    const orphan = await webhook("orphan")
    const again = await webhook("orphan again")

    const first = await receive(orphan)
    const second = await receive(again)

    expect([first.status, second.status]).toEqual([204, 204])
    expect(world.fake.control.subscriptions()).toEqual([])
    expect(await world.watches.subscriptionOf(kickStreamer.id)).toBeNull()
    expect(unsubscribeCalls()).toBe(1)
    expect(delivered).toEqual([])
  })

  it("keeps the record of an orphan subscription whose cancel failed and tries again after the retry time", async () => {
    await world.watches.unwatch(giveawayId)
    world.fake.control.failNext("unsubscribe", 503, 1)

    await receive(await webhook("orphan"))
    const keptRow = await world.watches.subscriptionOf(kickStreamer.id)
    world.clock.advance(300_000)
    await receive(await webhook("orphan again"))

    expect(keptRow).not.toBeNull()
    expect(world.fake.control.subscriptions()).toEqual([])
    expect(await world.watches.subscriptionOf(kickStreamer.id)).toBeNull()
  })

  it("drops a replay of a message it handed on before", async () => {
    const signed = await webhook()

    const first = await receive(signed)
    const replay = await receive(signed)

    expect([first.status, replay.status]).toEqual([204, 204])
    expect(delivered).toHaveLength(1)
  })

  it("refuses a message older than the time window, and one from too far ahead", async () => {
    const old = await webhook("old", new Date(world.clock.now() - 300_001))
    const ahead = await webhook("ahead", new Date(world.clock.now() + 300_001))

    expect((await receive(old)).status).toBe(401)
    expect((await receive(ahead)).status).toBe(401)
    expect(delivered).toEqual([])
  })

  it("accepts a message at the edge of the time window", async () => {
    const response = await receive(await webhook("edge", new Date(world.clock.now() - 300_000)))

    expect(response.status).toBe(204)
    expect(delivered).toHaveLength(1)
  })

  it("hands nothing on for a sender no room reads", async () => {
    await world.watches.watch(giveawayId, kickStreamer.id, [], world.clock.now())

    const response = await receive(await webhook())

    expect(response.status).toBe(204)
    expect(delivered).toEqual([])
  })

  it("answers 503 while Kick does not serve its key, so Kick sends the webhook again", async () => {
    world.fake.control.failNext("public-key", 500, 1)

    const response = await receive(await webhook())

    expect(response.status).toBe(503)
    expect(delivered).toEqual([])
  })

  it("ignores another event type without handing it on", async () => {
    const signed = await webhook()

    const response = await receive(signed, {
      headers: { ...signed.headers, "Kick-Event-Type": "channel.followed" },
    })

    expect(response.status).toBe(204)
    expect(delivered).toEqual([])
  })

  it("refuses a request without the Kick headers", async () => {
    const signed = await webhook()

    const response = await receive(signed, { headers: { "Content-Type": "application/json" } })

    expect(response.status).toBe(400)
  })

  it("keeps handing a message to the other rooms when one room fails", async () => {
    await world.watches.watch("g2", kickStreamer.id, [kickViewer.id], world.clock.now())
    const signed = await webhook()
    const reached: string[] = []

    const response = await receiveKickWebhook(
      deps,
      new Request(webhookUrl, { method: "POST", headers: signed.headers, body: signed.body }),
      async (id) => {
        if (id === giveawayId) throw new Error("room down")
        reached.push(id)
      },
    )

    expect(response.status).toBe(204)
    expect(reached).toEqual(["g2"])
  })
})

describe("parseChatEvent", () => {
  const event = {
    message_id: "m1",
    broadcaster: { user_id: 300, username: "Kick_Streamer", identity: null },
    sender: {
      user_id: 301,
      username: "Kick_Viewer",
      identity: {
        username_color: "#FFFFFF",
        badges: [
          { text: "Moderator", type: "moderator" },
          { text: "Subscriber", type: "subscriber", count: 3 },
        ],
      },
    },
    content: "hello",
  }

  it("reads the moderator and subscriber badges", () => {
    expect(parseChatEvent(JSON.stringify(event))?.message.roles).toEqual({
      subTier: 1,
      isVip: false,
      isModerator: true,
    })
  })

  it("refuses a sender id that is not a positive integer", () => {
    for (const userId of [0, -1, 1.5, "301", null]) {
      const body = JSON.stringify({ ...event, sender: { ...event.sender, user_id: userId } })
      expect(parseChatEvent(body)).toBeNull()
    }
  })

  it("refuses a body that is not JSON", () => {
    expect(parseChatEvent("not json")).toBeNull()
  })
})
