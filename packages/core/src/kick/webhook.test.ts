import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { SignedWebhook } from "@rafflink/fake-kick"
import {
  kickStreamer,
  kickViewer,
  kickWorld,
  userTokens,
  type KickWorld,
} from "../../test/kick-fixture.ts"
import type { ChatMessage } from "../platform/chat-source.ts"
import { KickWebhookKey, parseChatEvent, receiveKickWebhook } from "./webhook.ts"

const giveawayId = "g1"
const webhookUrl = "http://localhost/api/kick/webhook"

let world: KickWorld
let key: KickWebhookKey
let delivered: { giveawayId: string; message: ChatMessage }[]

beforeEach(async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  spyOn(console, "info").mockImplementation(() => {})
  world = kickWorld({ KICK_PUBLIC_KEY_REFRESH_SECONDS: "60", KICK_WEBHOOK_MAX_AGE_SECONDS: "300" })
  key = new KickWebhookKey(world.client, world.clock, world.config)
  delivered = []
  world.fake.control.setWebhookUrl(webhookUrl)
  const { accessToken } = await userTokens(world, kickStreamer, ["user:read", "events:subscribe"])
  await world.client.subscribeChat(accessToken, kickStreamer.id)
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
    { key, watches: world.watches, clock: world.clock, config: world.config },
    new Request(webhookUrl, { method: "POST", headers, body }),
    async (id, message) => {
      delivered.push({ giveawayId: id, message })
    },
  )
}

function publicKeyReads(): number {
  return world.fake.control.calls.filter((call) => call.path === "/public/v1/public-key").length
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

  it("does not read the key again sooner than the refresh time after the last read", async () => {
    expect((await receive(await webhook("first"))).status).toBe(204)
    await world.fake.control.rotateKey()
    world.clock.advance(59_999)

    const response = await receive(await webhook("too soon"))

    expect(response.status).toBe(401)
    expect(publicKeyReads()).toBe(1)
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
      { key, watches: world.watches, clock: world.clock, config: world.config },
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
