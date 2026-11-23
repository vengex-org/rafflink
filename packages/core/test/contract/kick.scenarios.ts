import { expect } from "bun:test"
import { kickUsers } from "./fake-kick.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import {
  defaultRules,
  kickWebhookPath,
  scenario,
  type CreatedGiveaway,
  type GiveawayOptions,
  type World,
} from "./world.ts"

// Kick tells no follows, subscriptions, VIPs or moderators, so only viewers get tickets.
const kickRules = {
  tickets: { viewer: 1, follower: 0, sub_t1: 0, sub_t2: 0, sub_t3: 0, vip: 0, moderator: 0 },
}

export function kickScenarios(context: ContractContext): void {
  scenario(context, "a streamer signs in with Kick and runs a Kick giveaway", async (world) => {
    const target = await world.start()
    const streamer = await world.signInKickStreamer(target)

    const session = await (await streamer.request("/api/session")).json()
    const giveaway = await world.createGiveaway(target, { streamer, rules: kickRules })
    const page = await (await streamer.request(`/api/g/${giveaway.code}`)).json()

    expect(session.streamer).toMatchObject({
      login: "kick_streamer",
      displayName: "Kick_Streamer",
      platform: "kick",
      capabilities: { followerCheck: false, moderatorRole: false, pageEntry: true },
    })
    expect(page).toMatchObject({ platform: "kick", streamerName: "Kick_Streamer" })
  })

  scenario(context, "a viewer enters a Kick giveaway with Kick sign-in", async (world) => {
    const target = await world.start()
    const giveaway = await kickGiveaway(world, target)

    const result = await world.enterKick(target, giveaway.code, kickUsers.viewer.id)

    expect(result).toMatchObject({ entry: "entered", reason: null })
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1 })
  })

  scenario(
    context,
    "a Twitch viewer start link of a Kick giveaway signs in with Kick",
    async (world) => {
      const target = await world.start()
      const giveaway = await kickGiveaway(world, target)

      const response = await fetch(
        new URL(`/auth/twitch/viewer/start?giveaway=${giveaway.code}`, target.url),
        { redirect: "manual" },
      )

      expect(response.headers.get("location")).toBe(
        `/auth/kick/viewer/start?giveaway=${giveaway.code}`,
      )
    },
  )

  scenario(context, "a refused Kick sign-in names Kick for the retry", async (world) => {
    const target = await world.start()

    const response = await fetch(new URL("/auth/kick/viewer?error=access_denied", target.url), {
      redirect: "manual",
    })

    expect(response.headers.get("location")).toBe("/?error=access_denied&platform=kick")
  })

  scenario(context, "a Kick chat message from the winner claims via chat", async (world) => {
    const target = await world.start()
    const giveaway = await drawnKickGiveaway(world, target)
    await waitForKickSubscription(world)

    const other = await world.kick.fake.control.sendChatMessage(
      kickUsers.streamer.id,
      kickUsers.viewer2.id,
      "claiming!",
    )
    const winner = await world.kick.fake.control.sendChatMessage(
      kickUsers.streamer.id,
      kickUsers.viewer.id,
      "claiming!",
    )
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the Kick chat message to claim",
    )

    expect([other, winner]).toEqual([204, 204])
    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(context, "a Kick webhook with a forged body claims nothing", async (world) => {
    const target = await world.start({ KICK_PUBLIC_KEY_REFRESH_SECONDS: "1" })
    const giveaway = await drawnKickGiveaway(world, target)
    await waitForKickSubscription(world)
    // A valid message reads the key; past the refresh time a failed signature is refused instead of asked again.
    const warm = await world.kick.fake.control.sendChatMessage(
      kickUsers.streamer.id,
      kickUsers.viewer2.id,
      "hi",
    )
    await Bun.sleep(1100)
    const signed = await world.kick.fake.control.chatWebhook(
      kickUsers.streamer.id,
      kickUsers.viewer.id,
      "hello",
    )
    if (signed === null) throw new Error("the fake Kick sent no webhook")

    const response = await fetch(new URL(kickWebhookPath, target.url), {
      method: "POST",
      headers: signed.headers,
      body: signed.body.replace("hello", "claim!"),
    })

    expect([warm, response.status]).toEqual([204, 401])
    expect((await world.live(giveaway)).winners[0]?.claim.state).toBe("waiting")
  })

  scenario(
    context,
    "the hourly validation deletes a Kick token whose refresh token Kick rejects",
    async (world) => {
      const target = await world.start()
      await world.signInKickStreamer(target)
      world.kick.fake.control.revokeUserTokens(kickUsers.streamer.id)

      await target.runValidateJob()
      const tokenCalls = () =>
        world.kick.fake.control.calls.filter((call) => call.path === "/oauth/token")
      const before = tokenCalls().length
      await target.runValidateJob()

      expect(before).toBeGreaterThan(0)
      expect(tokenCalls().length).toBe(before)
    },
  )

  scenario(
    context,
    "the Kick chat subscription is removed when the chat watch ends",
    async (world) => {
      const target = await world.start({ REROLL_WINDOW_SECONDS: "1" })
      await drawnKickGiveaway(world, target, { claimSeconds: 1 })
      await waitForKickSubscription(world)

      await world.waitFor(
        () => world.kick.fake.control.subscriptions().length === 0,
        "the Kick subscription to be removed",
      )

      expect(world.kick.fake.control.subscriptions()).toEqual([])
    },
  )
}

async function kickGiveaway(
  world: World,
  target: ContractTarget,
  options: GiveawayOptions = {},
): Promise<CreatedGiveaway> {
  const streamer = await world.signInKickStreamer(target)
  return world.createGiveaway(target, {
    ...options,
    streamer,
    rules: { ...defaultRules, ...kickRules },
  })
}

/** One Kick viewer enters, entries close and the viewer is the only possible winner. */
async function drawnKickGiveaway(
  world: World,
  target: ContractTarget,
  options: GiveawayOptions = {},
): Promise<CreatedGiveaway> {
  const giveaway = await kickGiveaway(world, target, options)
  await world.enterKick(target, giveaway.code, kickUsers.viewer.id)
  await world.closeGiveaway(giveaway)
  expect((await world.drawWinners(giveaway)).status).toBe(200)
  return giveaway
}

function waitForKickSubscription(world: World): Promise<void> {
  return world.waitFor(
    () => world.kick.fake.control.subscriptions().length >= 1,
    "the Kick chat subscription",
  )
}
