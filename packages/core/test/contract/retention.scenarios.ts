import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { publicOrigin, scenario } from "./world.ts"

// The retention time must cover the claim and reroll windows, so these shrink with it.
const shortRetention = {
  ENTRY_RETENTION_SECONDS: "3",
  CLAIM_SECONDS_MAX: "1",
  REROLL_WINDOW_SECONDS: "1",
}

export function retentionScenarios(context: ContractContext): void {
  scenario(
    context,
    "the entrants' data is deleted after the retention time while the counts and the winner with its name stay",
    async (world) => {
      const target = await world.start(shortRetention)
      const giveaway = await world.createGiveaway(target)
      const { viewer } = await world.enter(target, giveaway.code, users.viewer.id)
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway)
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
        winners: [{ n: 0, entrySeq: null, displayName: users.viewer.displayName }],
      })
      const entrants = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants?after=0`)
      expect(await entrants.json()).toEqual({ rows: [], more: false })
    },
  )

  scenario(
    context,
    "a deleted giveaway is gone from the dashboard, its pages and its code, and another streamer cannot delete it",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await world.enter(target, giveaway.code, users.viewer.id)
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway)
      const other = await world.createGiveaway(target, {
        streamer: await world.signInStreamer(target, users.otherStreamer.id),
      })
      const deleteOf = (streamer: typeof giveaway.streamer, id: string) =>
        streamer.request(`/api/dash/giveaways/${id}/delete`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: publicOrigin },
          body: "{}",
        })

      const refused = await deleteOf(other.streamer, giveaway.id)
      const deleted = await deleteOf(giveaway.streamer, giveaway.id)

      expect(refused.status).toBe(404)
      expect(deleted.status).toBe(200)
      expect((await giveaway.streamer.request(`/api/live/${giveaway.id}`)).status).toBe(404)
      expect((await giveaway.streamer.request(`/api/g/${giveaway.code}/verify`)).status).toBe(404)
      const list: { giveaways: unknown[] } = await (
        await giveaway.streamer.request("/api/dash/giveaways")
      ).json()
      expect(list.giveaways).toEqual([])
      expect((await other.streamer.request(`/api/live/${other.id}`)).status).toBe(200)
    },
  )

  scenario(
    context,
    "a closed giveaway whose entrants were deleted refuses to draw and stays closed",
    async (world) => {
      const target = await world.start(shortRetention)
      const giveaway = await world.createGiveaway(target)
      await world.enter(target, giveaway.code, users.viewer.id)
      await world.closeGiveaway(giveaway)
      await world.waitFor(async () => {
        const entrants = await giveaway.streamer.request(
          `/api/live/${giveaway.id}/entrants?after=0`,
        )
        const page: { rows: unknown[] } = await entrants.json()
        return page.rows.length === 0
      }, "the entries to be deleted")

      const draw = await world.drawWinners(giveaway)

      expect(draw.status).toBe(409)
      expect(await draw.json()).toEqual({ kind: "entries-deleted" })
      expect(await world.live(giveaway)).toMatchObject({ status: "closed", entrantCount: 1 })
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

  scenario(
    context,
    "a streamer's public history lists a drawn giveaway once the streamer turns it on, and not one they hid",
    async (world) => {
      const target = await world.start()
      const shown = await world.createGiveaway(target)
      await world.enter(target, shown.code, users.viewer.id)
      await world.closeGiveaway(shown)
      await world.drawWinners(shown)
      const hidden = await world.createGiveaway(target, { streamer: shown.streamer })
      await world.enter(target, hidden.code, users.viewer2.id)
      await world.closeGiveaway(hidden)
      await world.drawWinners(hidden)
      const post = (path: string, body: unknown) =>
        shown.streamer.request(path, {
          method: "POST",
          headers: { "content-type": "application/json", origin: publicOrigin },
          body: JSON.stringify(body),
        })
      const historyPath = `/api/s/twitch/${users.streamer.login}`

      const before = await shown.streamer.request(historyPath)
      await post(`/api/dash/giveaways/${hidden.id}/history`, { hidden: true })
      await post("/api/dash/history", { on: true })
      const after = await shown.streamer.request(historyPath)

      expect(before.status).toBe(404)
      expect(await after.json()).toMatchObject({
        streamer: { platform: "twitch", login: users.streamer.login },
        giveaways: [{ code: shown.code, entrantCount: 1, winners: 1 }],
      })
    },
  )
}
