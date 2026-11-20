import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { eventSubPath, scenario, type CreatedGiveaway, type World } from "./world.ts"

export function chatClaimScenarios(context: ContractContext): void {
  scenario(context, "a chat message from the winner claims via chat", async (world) => {
    const { giveaway } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)

    world.twitch.fake.control.sendChatMessage(users.streamer.id, users.viewer.id, "claiming!")
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the chat message to claim",
    )

    expect((await world.live(giveaway)).winners[0]?.claim).toEqual({
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

    expect((await world.live(giveaway)).winners[0]?.claim).toEqual({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(context, "the chat watch survives a reconnect request from Twitch", async (world) => {
    const { giveaway } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)

    world.twitch.fake.control.reconnect()
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

    expect((await world.live(giveaway)).winners[0]?.claim).toEqual({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(context, "the chat watch closes when no winner waits", async (world) => {
    const { giveaway } = await drawnWithOneWinner(world, await world.start())
    await waitForSubscription(world)

    const claimed = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
      n: 0,
    })
    await world.waitFor(
      () => world.twitch.fake.control.eventSubConnections() === 0,
      "the chat connection to close",
    )

    expect(claimed.status).toBe(200)
  })

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
}

/** One viewer enters, entries close and the viewer is the only possible winner. */
async function drawnWithOneWinner(
  world: World,
  target: ContractTarget,
): Promise<{ giveaway: CreatedGiveaway }> {
  const giveaway = await world.createGiveaway(target)
  await world.enter(target, giveaway.code, users.viewer.id)
  await world.closeGiveaway(giveaway)
  const drawn = await world.drawWinners(giveaway, 1)
  expect(drawn.status).toBe(200)
  return { giveaway }
}

function waitForSubscription(world: World): Promise<void> {
  return world.waitFor(
    () => world.twitch.fake.control.eventSubSubscriptions() >= 1,
    "the chat subscription",
  )
}
