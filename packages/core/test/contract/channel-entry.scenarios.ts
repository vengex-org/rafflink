import { expect } from "bun:test"
import type { Entrant } from "../../src/room/rows.ts"
import { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { scenario, type CreatedGiveaway, type World } from "./world.ts"

const reward = { id: "reward-enter", title: "Enter the giveaway", cost: 500 } as const
const otherReward = { id: "reward-hydrate", title: "Hydrate", cost: 100 } as const

export function channelEntryScenarios(context: ContractContext): void {
  scenario(
    context,
    "a sub, a resub, a gift sub received and a redemption of the chosen reward each enter once, with their tier",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const giveaway = await world.createGiveaway(target, {
        streamer: await channelEntryStreamer(world, target),
        rules: { subEntry: true, pointsReward: { id: reward.id, title: reward.title } },
      })
      const { control } = world.twitch.fake
      control.setSubscription(users.newViewer.id, users.streamer.id, "2000")
      await world.waitFor(() => control.eventSubSubscriptions() >= 3, "the channel subscriptions")

      control.sendSubscription(users.streamer.id, users.viewer.id, "new", "1000")
      control.sendSubscription(users.streamer.id, users.viewer2.id, "resub", "2000")
      control.sendSubscription(users.streamer.id, users.viewer3.id, "gift", "3000")
      control.sendRedemption(users.streamer.id, users.newViewer.id, reward.id)
      control.sendRedemption(users.streamer.id, users.otherStreamer.id, otherReward.id)
      control.sendRedemption(users.streamer.id, users.viewer.id, reward.id)
      control.sendSubscription(users.streamer.id, users.viewer.id, "resub", "1000")
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 4,
        "the four supporters to enter",
      )

      expect(
        (await entrants(giveaway)).map(({ login, group, tickets }) => ({ login, group, tickets })),
      ).toEqual([
        { login: users.viewer.login, group: "sub_t1", tickets: 3 },
        { login: users.viewer2.login, group: "sub_t2", tickets: 4 },
        { login: users.viewer3.login, group: "sub_t3", tickets: 5 },
        { login: users.newViewer.login, group: "sub_t2", tickets: 4 },
      ])
      expect(await lookup(target.url, giveaway, users.viewer3.login)).toEqual({ entered: true })
    },
  )

  scenario(context, "subs and redemptions after the close enter nobody", async (world) => {
    const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
    const giveaway = await world.createGiveaway(target, {
      streamer: await channelEntryStreamer(world, target),
      rules: { subEntry: true, pointsReward: { id: reward.id, title: reward.title } },
    })
    const { control } = world.twitch.fake
    await world.waitFor(() => control.eventSubSubscriptions() >= 3, "the channel subscriptions")

    expect((await world.closeGiveaway(giveaway)).status).toBe(200)
    await world.waitFor(() => control.eventSubSubscriptions() === 0, "the watch to end")
    control.sendSubscription(users.streamer.id, users.viewer.id, "new", "1000")
    control.sendRedemption(users.streamer.id, users.viewer2.id, reward.id)
    // Two check periods, in which a queued request would have been checked and entered.
    await Bun.sleep(2_500)

    expect((await world.live(giveaway)).entrantCount).toBe(0)
  })

  scenario(
    context,
    "a giveaway whose streamer token lacks the sub scope reports sub entry off instead of failing silently",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target, { rules: { subEntry: true } })

      await world.waitFor(
        async () => (await world.live(giveaway)).channelEntryOff,
        "the live page to report sub entry off",
      )

      expect(await world.live(giveaway)).toMatchObject({
        channelEntryOff: true,
        chatEntryOff: false,
      })
    },
  )
}

// An Affiliate with two rewards who signed in with the sub and points scopes, as the wizard's "Reconnect Twitch" does.
async function channelEntryStreamer(world: World, target: ContractTarget): Promise<Browser> {
  const { control } = world.twitch.fake
  control.addUser({ ...users.streamer, broadcasterType: "affiliate" })
  control.setCustomRewards(users.streamer.id, [reward, otherReward])
  const streamer = new Browser(target.url)
  await streamer.signInAs(
    users.streamer.id,
    "/auth/twitch/streamer/start?entry=sub,points",
    control,
  )
  return streamer
}

async function entrants(giveaway: CreatedGiveaway): Promise<readonly Entrant[]> {
  const response = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants`)
  const body: { rows: Entrant[] } = await response.json()
  return body.rows
}

async function lookup(base: URL, giveaway: CreatedGiveaway, login: string): Promise<unknown> {
  const url = new URL(`/api/g/${giveaway.code}/entered`, base)
  url.searchParams.set("login", login)
  return (await fetch(url)).json()
}
