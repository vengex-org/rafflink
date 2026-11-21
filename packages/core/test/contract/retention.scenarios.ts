import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { scenario } from "./world.ts"

export function retentionScenarios(context: ContractContext): void {
  scenario(
    context,
    "the entrants' data is deleted after the retention time while the counts and the winner stay",
    async (world) => {
      const target = await world.start({ ENTRY_RETENTION_SECONDS: "3" })
      const giveaway = await world.createGiveaway(target)
      const { viewer } = await world.enter(target, giveaway.code, users.viewer.id)
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway, 1)
      const meOf = async () => {
        const page: { me: { kind: string; entry: unknown } } = await (
          await viewer.request(`/api/g/${giveaway.code}`)
        ).json()
        return page.me
      }

      const before = await meOf()
      await world.waitFor(async () => (await meOf()).entry === null, "the entry to be deleted")

      expect(before).toMatchObject({ kind: "won", entry: { tickets: 1, group: "viewer" } })
      expect(await meOf()).toMatchObject({ kind: "won", entry: null })
      expect(await world.live(giveaway)).toMatchObject({
        status: "drawn",
        entrantCount: 1,
        ticketTotal: 1,
        lastNames: [],
        winners: [{ n: 0, entrySeq: null, displayName: null }],
      })
      const entrants = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants?after=0`)
      expect(await entrants.json()).toEqual({ rows: [], more: false })
    },
  )

  scenario(
    context,
    "a user beyond the sign-in limit is refused and others still enter",
    async (world) => {
      const target = await world.start({ ENTRY_USER_LIMIT_PER_MINUTE: "1" })
      const giveaway = await world.createGiveaway(target)
      const first = await world.enter(target, giveaway.code, users.viewer.id)

      const again = await world.enter(target, giveaway.code, users.viewer.id, first.viewer)
      const other = await world.enter(target, giveaway.code, users.viewer2.id)

      expect(first.entry).toBe("entered")
      expect(again.entry).toBe("rate-limited")
      expect(other.entry).toBe("entered")
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 2 })
    },
  )

  scenario(
    context,
    "a second callback from one address is refused before it reaches Twitch",
    async (world) => {
      const target = await world.start({ ENTRY_IP_LIMIT_PER_MINUTE: "1" })
      const giveaway = await world.createGiveaway(target)
      const first = await world.enterFromAddress(
        target,
        giveaway.code,
        users.viewer.id,
        "203.0.113.7",
      )
      const exchanges = world.twitchCalls("/oauth2/token")

      const second = await world.enterFromAddress(
        target,
        giveaway.code,
        users.viewer2.id,
        "203.0.113.7",
      )
      const elsewhere = await world.enterFromAddress(
        target,
        giveaway.code,
        users.viewer3.id,
        "203.0.113.8",
      )

      expect(first.entry).toBe("entered")
      expect(second.entry).toBe("rate-limited")
      expect(elsewhere.entry).toBe("entered")
      expect(world.twitchCalls("/oauth2/token") - exchanges).toBe(1)
    },
  )
}
