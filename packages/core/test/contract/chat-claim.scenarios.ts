import { expect } from "bun:test"
import type { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import type { OverlayMessage } from "./socket.ts"
import {
  eventSubPath,
  publicOrigin,
  scenario,
  type CreatedGiveaway,
  type GiveawayOptions,
  type World,
} from "./world.ts"

export function chatClaimScenarios(context: ContractContext): void {
  scenario(context, "a chat message from the winner claims via chat", async (world) => {
    const { giveaway } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)

    world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "claiming!")
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the chat message to claim",
    )

    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(context, "a chat message from someone who did not win claims nothing", async (world) => {
    const { giveaway } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)

    world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer2.id, "claiming!")
    world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "claiming!")
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the winner's message to claim",
    )

    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(context, "the chat watch survives a reconnect request from Twitch", async (world) => {
    const target = await world.start()
    // Twitch can ask to reconnect before the subscription it is creating has answered.
    world.twitch.fake.control.reconnectOnNextSubscription()
    const { giveaway } = await drawnWithOneWinner(world, target)

    await world.waitFor(() => world.twitchCalls(eventSubPath) >= 2, "the second connection")
    await world.waitFor(
      () => world.twitch.fake.control.eventSubConnections() === 1,
      "the old connection to close",
    )
    world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "claiming!")
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the chat message to claim after the reconnect",
    )

    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(
    context,
    "the chat watch stays open for a claimed winner and closes when the reroll window ends",
    async (world) => {
      const { giveaway } = await drawnWithOneWinner(
        world,
        await world.start({ REROLL_WINDOW_SECONDS: "1" }),
        { claimSeconds: 1 },
      )
      await waitForSubscription(world)

      const claimed = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
        n: 0,
      })

      expect(claimed.status).toBe(200)
      expect(world.twitch.fake.control.eventSubConnections()).toBe(1)
      await world.waitFor(
        () => world.twitch.fake.control.eventSubConnections() === 0,
        "the chat connection to close",
      )
    },
  )

  scenario(
    context,
    "the live page gets the winner's chat and the overlay never does",
    async (world) => {
      const target = await world.start()
      const { giveaway } = await drawnWithOneWinner(world, target)
      await waitForSubscription(world)
      const live = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
        cookie: giveaway.streamer.cookieHeader(),
        origin: publicOrigin,
      })
      const overlayUrl = new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url)
      const overlay = world.openSocket<OverlayMessage>(overlayUrl)
      await world.waitFor(
        () => live.messages.length >= 1 && overlay.messages.length >= 1,
        "the first snapshots",
      )

      world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer2.id, "not mine")
      world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "hello chat")
      await world.waitFor(
        () => live.messages.some((message) => message.winnerChat.length > 0),
        "the winner's message on the live socket",
      )
      await world.waitFor(
        () => overlay.messages.some((message) => message.winners[0]?.claim.state === "claimed"),
        "the overlay push after the chat claim",
      )

      expect(live.messages.at(-1)?.winnerChat).toMatchObject([
        { name: users.viewer.displayName, text: "hello chat" },
      ])
      expect((await world.live(giveaway)).winnerChat.map((line) => line.text)).toEqual([
        "hello chat",
      ])
      const overlayTexts = [
        JSON.stringify(overlay.messages),
        await (await fetch(overlayUrl)).text(),
      ]
      for (const text of overlayTexts) {
        expect(text).not.toContain("winnerChat")
        expect(text).not.toContain("hello chat")
      }
    },
  )

  scenario(
    context,
    "a winner's chat after the claim time shows but claims nothing",
    async (world) => {
      const target = await world.start({ REROLL_WINDOW_SECONDS: "60" })
      const { giveaway } = await drawnWithOneWinner(world, target, { claimSeconds: 1 })
      await waitForSubscription(world)
      await world.waitFor(
        async () => (await world.live(giveaway)).winners[0]?.claim.state === "expired",
        "the claim time to end",
      )

      world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "too late")
      await world.waitFor(
        async () => (await world.live(giveaway)).winnerChat.length > 0,
        "the late message to show",
      )

      expect(await world.live(giveaway)).toMatchObject({
        winners: [{ claim: { state: "expired" } }],
        winnerChat: [{ text: "too late" }],
      })
    },
  )

  scenario(
    context,
    "an EventSub failure shows Chat claim unavailable and a manual claim still works",
    async (world) => {
      world.twitch.fake.control.failNext("eventsub", 500, 1)
      const { giveaway } = await drawnWithOneWinner(world, await world.start())

      await world.waitFor(
        async () => (await world.live(giveaway)).chatClaimUnavailable,
        "the chat claim to become unavailable",
      )
      const marked = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
        n: 0,
      })

      expect(await world.live(giveaway)).toMatchObject({
        chatClaimUnavailable: true,
        eventSubFailures: 1,
        winners: [{ claim: { state: "claimed", via: "manual" } }],
      })
      expect(marked.status).toBe(200)
      expect(world.twitch.fake.control.eventSubConnections()).toBe(0)
    },
  )

  scenario(context, "a revoked chat subscription shows Chat claim unavailable", async (world) => {
    const { giveaway, viewer } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)
    const meOf = async () => (await (await viewer.request(`/api/g/${giveaway.code}`)).json()).me
    expect(await meOf()).toMatchObject({ kind: "won", chatClaimAvailable: true })

    world.twitch.fake.control.revokeChatSubscriptions()
    await world.waitFor(
      async () => (await world.live(giveaway)).chatClaimUnavailable,
      "the revocation to make the chat claim unavailable",
    )

    expect(await world.live(giveaway)).toMatchObject({ eventSubFailures: 1 })
    expect(await meOf()).toMatchObject({ kind: "won", chatClaimAvailable: false })
    expect(world.twitch.fake.control.eventSubConnections()).toBe(0)
  })

  scenario(
    context,
    "a reroll after an EventSub failure opens the chat watch again",
    async (world) => {
      world.twitch.fake.control.failNext("eventsub", 500, 1)
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      for (const viewer of [users.viewer, users.viewer2]) {
        await world.enter(target, giveaway.code, viewer.id)
      }
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway)
      await world.waitFor(
        async () => (await world.live(giveaway)).chatClaimUnavailable,
        "the chat claim to become unavailable",
      )

      const rerolled = await giveaway.streamer.postJson(
        `/api/dash/giveaways/${giveaway.id}/reroll`,
        {
          n: 0,
        },
      )
      await waitForSubscription(world)
      world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "claiming!")
      world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer2.id, "claiming!")
      await world.waitFor(
        async () => (await world.live(giveaway)).winners[1]?.claim.state === "claimed",
        "the new winner to claim in chat",
      )

      expect(rerolled.status).toBe(200)
      expect(await world.live(giveaway)).toMatchObject({
        chatClaimUnavailable: false,
        eventSubFailures: 1,
        winners: [{ claim: { state: "rerolled" } }, { claim: { state: "claimed", via: "chat" } }],
      })
    },
  )
}

/** One viewer enters, entries close and the viewer is the only possible winner. */
async function drawnWithOneWinner(
  world: World,
  target: ContractTarget,
  options: GiveawayOptions = {},
): Promise<{ giveaway: CreatedGiveaway; viewer: Browser }> {
  const giveaway = await world.createGiveaway(target, options)
  const { viewer } = await world.enter(target, giveaway.code, users.viewer.id)
  await world.closeGiveaway(giveaway)
  const drawn = await world.drawWinners(giveaway)
  expect(drawn.status).toBe(200)
  return { giveaway, viewer }
}

function waitForSubscription(world: World): Promise<void> {
  return world.waitFor(
    () => world.twitch.fake.control.eventSubSubscriptions() >= 1,
    "the chat subscription",
  )
}
