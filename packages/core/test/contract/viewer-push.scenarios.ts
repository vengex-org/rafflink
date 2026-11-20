import { expect } from "bun:test"
import type { ViewerPush } from "../../src/room/giveaway-room.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { publicOrigin, scenario, type CreatedGiveaway, type World } from "./world.ts"

const upgrade = { upgrade: "websocket", connection: "Upgrade" }

export function viewerPushScenarios(context: ContractContext): void {
  scenario(
    context,
    "a viewer's socket gets the current outcome first, then closing and nothing for entries",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const { messages } = openViewerSocket(world, target.url, giveaway)
      await world.waitFor(() => messages.length >= 1, "the first outcome")

      await world.enter(target, giveaway.code, users.viewer.id)
      await world.enter(target, giveaway.code, users.viewer2.id)
      await world.closeGiveaway(giveaway)
      await world.waitFor(
        () => messages.some((message) => message.status === "closed"),
        "the closed outcome",
      )

      expect(messages[0]).toMatchObject({
        status: "open",
        finished: false,
        chatClaimAvailable: true,
        winners: [],
      })
      expect(messages.map((message) => message.status)).toEqual(["open", "closed"])
    },
  )

  scenario(
    context,
    "the draw and the claim are pushed with the winner's platform user id and the claim deadline",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const entered = await world.enter(target, giveaway.code, users.viewer.id)
      const { messages } = openViewerSocket(world, target.url, giveaway)
      await world.waitFor(() => messages.length >= 1, "the first outcome")

      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway, 1)
      await world.waitFor(
        () => messages.some((message) => message.status === "drawn"),
        "the draw outcome",
      )
      const claim = await entered.viewer.postJson(`/api/g/${giveaway.code}/claim`, {})
      await world.waitFor(() => messages.some((message) => message.finished), "the claimed outcome")

      const drawn = messages.find((message) => message.status === "drawn")
      expect(claim.status).toBe(200)
      expect(drawn).toMatchObject({
        finished: false,
        winners: [{ n: 0, platformUserId: users.viewer.id, claim: { state: "waiting" } }],
      })
      expect((drawn?.winners[0]?.claimUntil ?? 0) - (drawn?.now ?? 0)).toBeGreaterThan(290_000)
      expect(messages.at(-1)).toMatchObject({
        status: "drawn",
        finished: true,
        winners: [
          { platformUserId: users.viewer.id, claim: { state: "claimed", via: "rafflink" } },
        ],
      })
    },
  )

  scenario(
    context,
    "a reroll is pushed as the replaced pick and the new winner, and a viewer who connects late gets the same",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await world.enter(target, giveaway.code, users.viewer.id)
      await world.enter(target, giveaway.code, users.viewer2.id)
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway, 1)
      const early = openViewerSocket(world, target.url, giveaway)
      await world.waitFor(() => early.messages.length >= 1, "the first outcome")

      await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/reroll`, { n: 0 })
      await world.waitFor(
        () => early.messages.some((message) => message.winners.length === 2),
        "the reroll outcome",
      )
      const late = openViewerSocket(world, target.url, giveaway)
      await world.waitFor(() => late.messages.length >= 1, "the late first outcome")

      expect(early.messages.at(-1)?.winners.map((winner) => winner.claim.state)).toEqual([
        "rerolled",
        "waiting",
      ])
      expect(late.messages[0]?.winners).toEqual(early.messages.at(-1)?.winners)
    },
  )

  scenario(
    context,
    "a viewer's socket carries public data only and the streamer's socket never receives it",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const entered = await world.enter(target, giveaway.code, users.viewer.id)
      const viewerSocket = openViewerSocket(
        world,
        target.url,
        giveaway,
        entered.viewer.cookieHeader(),
      )
      const streamerSocket = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
        cookie: giveaway.streamer.cookieHeader(),
        origin: publicOrigin,
      })
      await world.waitFor(
        () => viewerSocket.messages.length >= 1 && streamerSocket.messages.length >= 1,
        "both first messages",
      )

      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway, 1)
      await world.waitFor(
        () => viewerSocket.messages.some((message) => message.status === "drawn"),
        "the draw outcome",
      )

      const text = JSON.stringify(viewerSocket.messages)
      for (const message of viewerSocket.messages) {
        expect(Object.keys(message).toSorted()).toEqual([
          "chatClaimAvailable",
          "finished",
          "now",
          "status",
          "winners",
        ])
      }
      const winner = viewerSocket.messages.at(-1)?.winners[0]
      expect(Object.keys(winner ?? {}).toSorted()).toEqual([
        "claim",
        "claimUntil",
        "n",
        "platformUserId",
      ])
      for (const secret of [
        giveaway.overlayToken,
        giveaway.id,
        entered.viewer.cookieHeader(),
        users.viewer.login,
        users.viewer.displayName,
      ]) {
        expect(text).not.toContain(secret)
      }
      expect(streamerSocket.messages.every((message) => "entrantCount" in message)).toBe(true)
      expect(viewerSocket.messages.some((message) => "entrantCount" in message)).toBe(false)
    },
  )

  scenario(
    context,
    "a viewer's socket needs the site's own origin and an existing giveaway",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const live = new URL(`/api/g/${giveaway.code}/live`, target.url)
      const unknown = new URL("/api/g/NOPE0/live", target.url)

      const statuses = [
        (await fetch(live, { headers: { ...upgrade, origin: "https://evil.example" } })).status,
        (await fetch(live, { headers: upgrade })).status,
        (await fetch(unknown, { headers: { ...upgrade, origin: publicOrigin } })).status,
        (await fetch(live)).status,
      ]

      expect(statuses).toEqual([403, 403, 404, 426])
    },
  )
}

function openViewerSocket(world: World, baseUrl: URL, giveaway: CreatedGiveaway, cookie?: string) {
  return world.openSocket<ViewerPush>(new URL(`/api/g/${giveaway.code}/live`, baseUrl), {
    origin: publicOrigin,
    ...(cookie === undefined ? {} : { cookie }),
  })
}
