import { expect } from "bun:test"
import type { Entrant } from "../../src/room/rows.ts"
import { Browser } from "./browser.ts"
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

// Kick's API tells no follows, subscriptions, VIPs or moderators, so a giveaway with page entry gives only viewers tickets.
const kickRules = {
  tickets: {
    viewer: 1,
    follower: 0,
    sub_t1: 0,
    sub_t2: 0,
    sub_t3: 0,
    member: 0,
    vip: 0,
    moderator: 0,
  },
}

const reward = { id: "01HKICKREWARDENTER0000000", title: "Enter the giveaway" } as const
const otherReward = { id: "01HKICKREWARDHYDRATE00000", title: "Hydrate" } as const

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

  scenario(
    context,
    "a Kick chat keyword enters chatters with the tickets of their badges, and other messages enter nobody",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const streamer = await world.signInKickStreamer(target)
      const giveaway = await world.createGiveaway(target, {
        streamer,
        rules: {
          tickets: { ...kickRules.tickets, sub_t1: 3, moderator: 7 },
          chatKeyword: "!enter",
          pageEntry: false,
        },
      })
      await waitForKickSubscription(world)
      const { control } = world.kick.fake

      const statuses = [
        await control.sendChatMessage(kickUsers.streamer.id, kickUsers.viewer.id, "!enter", [
          "subscriber",
        ]),
        await control.sendChatMessage(kickUsers.streamer.id, kickUsers.viewer2.id, "hello !enter"),
        await control.sendChatMessage(kickUsers.streamer.id, kickUsers.viewer2.id, "!Enter me", [
          "moderator",
        ]),
        await control.sendChatMessage(kickUsers.streamer.id, kickUsers.viewer3.id, "gg"),
      ]
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 2,
        "the two keyword chatters to enter",
      )

      expect(statuses).toEqual([204, 204, 204, 204])
      expect(
        (await entrants(giveaway)).map(({ login, group, tickets }) => ({ login, group, tickets })),
      ).toEqual([
        { login: "kick_viewer", group: "sub_t1", tickets: 3 },
        { login: "kick_viewer2", group: "moderator", tickets: 7 },
      ])
    },
  )

  scenario(
    context,
    "a Kick sub, renewal, gift recipient and redemption of the chosen reward each enter once, and none after the close",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const { control } = world.kick.fake
      control.setRewards(kickUsers.streamer.id, [
        { ...reward, cost: 500, enabled: true },
        { ...otherReward, cost: 100, enabled: true },
      ])
      const streamer = new Browser(target.url)
      await streamer.signInAs(
        kickUsers.streamer.id,
        "/auth/kick/streamer/start?entry=sub,points",
        control,
      )
      const giveaway = await world.createGiveaway(target, {
        streamer,
        rules: { ...kickRules, subEntry: true, pointsReward: reward },
      })
      // Three sub events and the redemption event; a giveaway without a keyword or winners reads no chat.
      await world.waitFor(() => control.subscriptions().length === 4, "the Kick subscriptions")
      const broadcaster = kickUsers.streamer.id

      await control.sendSubscription(broadcaster, "new", [kickUsers.viewer.id])
      await control.sendSubscription(broadcaster, "renewal", [kickUsers.viewer2.id])
      await control.sendSubscription(broadcaster, "gifts", [kickUsers.viewer3.id])
      await control.sendRedemption(broadcaster, kickUsers.viewer4.id, reward.id, "pending")
      await control.sendRedemption(broadcaster, kickUsers.viewer4.id, reward.id, "accepted")
      await control.sendRedemption(broadcaster, kickUsers.viewer5.id, otherReward.id, "accepted")
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 4,
        "the four supporters to enter",
      )
      const late = await control.subscriptionWebhook(broadcaster, "new", [kickUsers.viewer5.id])
      if (late === null) throw new Error("the fake Kick sent no webhook")
      await world.closeGiveaway(giveaway)
      const lateStatus = (
        await fetch(late.url, { method: "POST", headers: late.headers, body: late.body })
      ).status

      expect(lateStatus).toBe(204)
      expect(
        (await entrants(giveaway)).map(({ login, group, tickets }) => ({ login, group, tickets })),
      ).toEqual(
        ["kick_viewer", "kick_viewer2", "kick_viewer3", "kick_viewer4"].map((login) => ({
          login,
          group: "viewer",
          tickets: 1,
        })),
      )
    },
  )

  scenario(
    context,
    "a Kick points giveaway on a token without channel:rewards:read is refused with a reconnect answer",
    async (world) => {
      const target = await world.start()
      const streamer = await world.signInKickStreamer(target)

      const response = await streamer.postJson("/api/dash/giveaways", {
        rules: { ...defaultRules, ...kickRules, pointsReward: reward },
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: "reconnect" })
    },
  )
}

async function entrants(giveaway: CreatedGiveaway): Promise<readonly Entrant[]> {
  const response = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants`)
  const body: { rows: Entrant[] } = await response.json()
  return body.rows
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
