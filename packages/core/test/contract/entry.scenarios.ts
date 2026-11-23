import { expect } from "bun:test"
import type { GiveawayRules } from "../../src/domain/rules.ts"
import { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { callbackOutcome, defaultRules, scenario, type World } from "./world.ts"

export function entryScenarios(context: ContractContext): void {
  scenario(context, "a viewer enters with the tickets of their best group", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const { control } = world.twitch.fake
    control.setFollowing(users.viewer.id, users.streamer.id, true)
    control.setSubscription(users.viewer.id, users.streamer.id, "2000")

    const result = await world.enter(target, giveaway.code, users.viewer.id)

    expect(result.entry).toBe("entered")
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1, ticketTotal: 4 })
  })

  scenario(context, "a duplicate entry keeps the first entry", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const first = await world.enter(target, giveaway.code, users.viewer.id)
    world.twitch.fake.control.setSubscription(users.viewer.id, users.streamer.id, "3000")

    const second = await world.enter(target, giveaway.code, users.viewer.id, first.viewer)

    expect(first.entry).toBe("entered")
    expect(second.entry).toBe("already-in")
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1, ticketTotal: 1 })
  })

  scenario(context, "a viewer who is not subscribed is refused by a subs-only giveaway", (world) =>
    expectRefused(world, { subsOnly: true }, users.viewer.id, "subs-only"),
  )

  scenario(
    context,
    "a viewer who does not follow is refused by a followers-only giveaway",
    (world) => expectRefused(world, { followersOnly: true }, users.viewer.id, "followers-only"),
  )

  scenario(context, "an account younger than the minimum age is refused", (world) =>
    expectRefused(world, { minAccountAgeDays: 30 }, users.newViewer.id, "account-too-young"),
  )

  scenario(context, "a viewer whose best group has no tickets is refused", (world) =>
    expectRefused(
      world,
      { tickets: { ...defaultRules.tickets, viewer: 0 } },
      users.viewer.id,
      "no-tickets",
    ),
  )

  scenario(context, "the broadcaster cannot enter their own giveaway", (world) =>
    expectRefused(world, {}, users.streamer.id, "broadcaster"),
  )

  scenario(context, "a forged state writes nothing", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const viewer = new Browser(target)
    const authorizeUrl = await viewer.beginSignIn(
      `/auth/twitch/viewer/start?giveaway=${giveaway.code}`,
    )
    const callback = await viewer.consent(authorizeUrl, users.viewer.id, world.twitch.fake.control)
    callback.searchParams.set("state", "forged")

    const outcome = callbackOutcome(await viewer.finishSignIn(callback))

    expect(outcome.entry).toBe("invalid-state")
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
  })

  scenario(context, "a forged nonce writes nothing", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const viewer = new Browser(target)
    const authorizeUrl = await viewer.beginSignIn(
      `/auth/twitch/viewer/start?giveaway=${giveaway.code}`,
    )
    authorizeUrl.searchParams.set("nonce", "forged")
    const callback = await viewer.consent(authorizeUrl, users.viewer.id, world.twitch.fake.control)

    const outcome = callbackOutcome(await viewer.finishSignIn(callback))

    expect(outcome.entry).toBe("invalid-state")
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
  })

  scenario(context, "a Helix 503 is retried once and the viewer enters", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    world.twitch.fake.control.failNext("subscriptions", 503, 1)

    const result = await world.enter(target, giveaway.code, users.viewer.id)

    expect(result.entry).toBe("entered")
    expect(world.twitchCalls("/helix/subscriptions/user")).toBe(2)
  })

  scenario(
    context,
    "a Helix 503 that repeats after the retry asks the viewer to try again",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      world.twitch.fake.control.failNext("subscriptions", 503, 2)

      const result = await world.enter(target, giveaway.code, users.viewer.id)

      expect(result.entry).toBe("try-again")
      expect(world.twitchCalls("/helix/subscriptions/user")).toBe(2)
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
    },
  )

  scenario(
    context,
    "a Helix 429 after the code exchange asks the viewer to try again",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      world.twitch.fake.control.failNext("users", 429, 1)

      const result = await world.enter(target, giveaway.code, users.viewer.id)

      expect(result.entry).toBe("try-again")
      expect(result.ticket).toBeNull()
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
    },
  )

  scenario(
    context,
    "a Helix 500 after the code exchange asks the viewer to try again",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      world.twitch.fake.control.failNext("followed", 500, 1)

      const result = await world.enter(target, giveaway.code, users.viewer.id)

      expect(result.entry).toBe("try-again")
      expect(result.ticket).toBeNull()
      expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
    },
  )
}

async function expectRefused(
  world: World,
  rules: Partial<GiveawayRules>,
  userId: string,
  reason: string,
): Promise<void> {
  const target = await world.start()
  const giveaway = await world.createGiveaway(target, { rules })

  const result = await world.enter(target, giveaway.code, userId)

  expect(result.entry).toBe("not-eligible")
  expect(result.reason).toBe(reason)
  expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0, ticketTotal: 0 })
}
