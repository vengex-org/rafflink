import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { scenario } from "./world.ts"

export function queueScenarios(context: ContractContext): void {
  scenario(
    context,
    "a token endpoint 429 queues the code and the page polls until the viewer is entered",
    async (world) => {
      const target = await world.start({ QUEUE_COOLDOWN_SECONDS: "1" })
      const giveaway = await world.createGiveaway(target)
      world.twitch.fake.control.failNext("token", 429, 1)

      const queued = await world.enter(target, giveaway.code, users.viewer.id)
      const result = await world.settle(queued.viewer, giveaway.code, queued.ticket ?? "")

      expect(queued.entry).toBe("pending")
      expect(queued.ticket).not.toBeNull()
      expect(result).toMatchObject({ kind: "entered", entry: { group: "viewer", tickets: 1 } })
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1 })
    },
  )

  scenario(
    context,
    "after the first 429 new codes are queued without trying the token endpoint",
    async (world) => {
      const target = await world.start({ QUEUE_COOLDOWN_SECONDS: "4" })
      const giveaway = await world.createGiveaway(target)
      await world.waitForFirstRoleRefresh()
      world.twitch.fake.control.failNext("token", 429, 1)
      const first = await world.enter(target, giveaway.code, users.viewer.id)
      const callsAfterFirst = world.twitchCalls("/oauth2/token")

      const second = await world.enter(target, giveaway.code, users.viewer2.id)

      expect(first.entry).toBe("pending")
      expect(second.entry).toBe("pending")
      expect(world.twitchCalls("/oauth2/token")).toBe(callsAfterFirst)
      const results = [
        await world.settle(first.viewer, giveaway.code, first.ticket ?? ""),
        await world.settle(second.viewer, giveaway.code, second.ticket ?? ""),
      ]
      expect(results.map((result) => result.kind)).toEqual(["entered", "entered"])
    },
  )

  scenario(
    context,
    "a code older than the maximum age is dropped and counted in the admin JSON",
    async (world) => {
      const target = await world.start({
        QUEUE_COOLDOWN_SECONDS: "3",
        QUEUE_CODE_MAX_AGE_SECONDS: "2",
        QUEUE_POLL_MAX_SECONDS: "1",
      })
      const giveaway = await world.createGiveaway(target)
      await world.waitForFirstRoleRefresh()
      world.twitch.fake.control.failNext("token", 429, 1)
      const queued = await world.enter(target, giveaway.code, users.viewer.id)
      const callsAfterQueue = world.twitchCalls("/oauth2/token")

      const result = await world.settle(queued.viewer, giveaway.code, queued.ticket ?? "")

      expect(queued.entry).toBe("pending")
      expect(result).toEqual({ kind: "dropped" })
      expect(world.twitchCalls("/oauth2/token")).toBe(callsAfterQueue)
      expect(await world.queueStats(giveaway.streamer)).toMatchObject({ dropped: 1 })
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
    },
  )
}
