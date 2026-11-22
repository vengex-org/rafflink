import { expect } from "bun:test"
import type { Entrant } from "../../src/room/rows.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { scenario, type CreatedGiveaway } from "./world.ts"

export function chatEntryScenarios(context: ContractContext): void {
  scenario(
    context,
    "the chat keyword enters a viewer once, with the tickets of their badges and their follow",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const giveaway = await world.createGiveaway(target, { rules: { chatKeyword: "!enter" } })
      const { control } = world.twitch.fake
      control.setSubscription(users.viewer.id, users.streamer.id, "2000")
      control.setFollowing(users.viewer2.id, users.streamer.id, true)
      await world.waitFor(() => control.eventSubSubscriptions() >= 1, "the chat subscription")

      control.sendChatMessage(users.streamer.id, users.viewer.id, "!enter")
      control.sendChatMessage(users.streamer.id, users.viewer.id, "!enter")
      control.sendChatMessage(users.streamer.id, users.viewer2.id, "!ENTER me")
      control.sendChatMessage(users.streamer.id, users.viewer3.id, "hello")
      control.sendChatMessage(users.streamer.id, users.streamer.id, "!enter")
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 2,
        "both chatters to enter",
      )

      expect(
        (await entrants(giveaway)).map(({ login, group, tickets }) => ({ login, group, tickets })),
      ).toEqual([
        { login: users.viewer.login, group: "sub_t2", tickets: 4 },
        { login: users.viewer2.login, group: "follower", tickets: 2 },
      ])
      expect((await world.live(giveaway)).entrantCount).toBe(2)
    },
  )

  scenario(
    context,
    "a viewer who entered by chat is already in on the page, and the lookup says yes or no only",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const giveaway = await world.createGiveaway(target, { rules: { chatKeyword: "!enter" } })
      const { control } = world.twitch.fake
      await world.waitFor(() => control.eventSubSubscriptions() >= 1, "the chat subscription")

      control.sendChatMessage(users.streamer.id, users.viewer.id, "!enter")
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 1,
        "the chatter to enter",
      )
      const page = await world.enter(target, giveaway.code, users.viewer.id)

      expect(page.entry).toBe("already-in")
      expect(await lookup(target.url, giveaway, users.viewer.login.toUpperCase())).toEqual({
        status: 200,
        body: { entered: true },
      })
      expect(await lookup(target.url, giveaway, users.viewer2.login)).toEqual({
        status: 200,
        body: { entered: false },
      })
      expect((await lookup(target.url, giveaway, " ")).status).toBe(400)
    },
  )
}

async function entrants(giveaway: CreatedGiveaway): Promise<readonly Entrant[]> {
  const response = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants`)
  const body: { rows: Entrant[] } = await response.json()
  return body.rows
}

async function lookup(
  base: URL,
  giveaway: CreatedGiveaway,
  login: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`/api/g/${giveaway.code}/entered`, base)
  url.searchParams.set("login", login)
  const response = await fetch(url)
  return { status: response.status, body: await response.json() }
}
