import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { moderatorsPath, scenario, vipsPath, type World } from "./world.ts"

export function liveScenarios(context: ContractContext): void {
  scenario(context, "a viewer on the VIP list enters with the VIP tickets", (world) =>
    expectRoleTickets(world, "vip", vipsPath, 6),
  )

  scenario(context, "a viewer on the moderator list enters with the moderator tickets", (world) =>
    expectRoleTickets(world, "moderator", moderatorsPath, 7),
  )

  scenario(context, "a failed role refresh is counted in the live JSON", async (world) => {
    const target = await world.start()
    world.twitch.fake.control.failNext("vips", 503, 2)
    const giveaway = await world.createGiveaway(target)

    await world.waitFor(
      async () => (await world.live(giveaway)).roleRefreshFailures >= 1,
      "the role refresh failure to be counted",
    )

    expect(await world.live(giveaway)).toMatchObject({
      roleRefreshFailures: 1,
      eventSubFailures: 0,
    })
  })

  scenario(context, "the live WebSocket pushes a snapshot after an entry", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const { messages } = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
      cookie: giveaway.streamer.cookieHeader(),
    })
    await world.waitFor(() => messages.length >= 1, "the first snapshot")

    await world.enter(target, giveaway.code, users.viewer.id)
    await world.waitFor(
      () => messages.some((message) => message.entrantCount === 1),
      "the snapshot after the entry",
    )

    expect(messages[0]).toMatchObject({
      entrantCount: 0,
      lastNames: [],
      title: "Giveaway",
      code: giveaway.code,
    })
    expect(messages.at(-1)).toMatchObject({
      entrantCount: 1,
      ticketTotal: 1,
      lastNames: [users.viewer.displayName],
    })
  })

  scenario(
    context,
    "the overlay with a valid token shows the live view read-only",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await world.enter(target, giveaway.code, users.viewer.id)
      const overlay = new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url)

      const read = await fetch(overlay)
      const write = await fetch(overlay, { method: "POST" })

      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({ status: "open", entrantCount: 1 })
      expect(write.status).toBe(404)
    },
  )

  scenario(
    context,
    "the owner's live JSON carries the overlay token and the overlay's does not",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)

      const owner = await (await giveaway.streamer.request(`/api/live/${giveaway.id}`)).json()
      const overlay = await (
        await fetch(new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url))
      ).json()

      expect(owner.overlayToken).toBe(giveaway.overlayToken)
      expect(overlay.overlayToken).toBeUndefined()
    },
  )

  scenario(context, "the overlay with a wrong token answers 404", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const wrong = `${giveaway.overlayToken.slice(0, -1)}${giveaway.overlayToken.endsWith("0") ? "1" : "0"}`

    const response = await fetch(new URL(`/api/overlay/${giveaway.id}/${wrong}`, target.url))

    expect(response.status).toBe(404)
  })
}

// The room refreshes roles on its alarm. A refresh that starts after the role was set has finished once
// the next refresh asks Twitch again, so the viewer only enters after two more calls.
async function expectRoleTickets(
  world: World,
  role: "vip" | "moderator",
  path: string,
  tickets: number,
): Promise<void> {
  const target: ContractTarget = await world.start({ ROLE_REFRESH_SECONDS: "1" })
  const giveaway = await world.createGiveaway(target)
  world.twitch.fake.control.setRole(users.streamer.id, users.viewer.id, role, true)
  const callsWhenSet = world.twitchCalls(path)
  await world.waitFor(
    () => world.twitchCalls(path) >= callsWhenSet + 2,
    `two role refreshes after the ${role} was set`,
  )

  const result = await world.enter(target, giveaway.code, users.viewer.id)

  expect(result.entry).toBe("entered")
  expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1, ticketTotal: tickets })
}
