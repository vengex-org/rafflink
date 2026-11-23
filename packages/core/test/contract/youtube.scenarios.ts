import { expect } from "bun:test"
import type { Entrant } from "../../src/room/rows.ts"
import { Browser } from "./browser.ts"
import { youtubeChannels } from "./fake-youtube.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { defaultRules, scenario, type CreatedGiveaway, type World } from "./world.ts"

// YouTube tells members and moderators in chat, nothing else; viewers enter only by chat keyword.
const youtubeRules = {
  tickets: {
    viewer: 1,
    follower: 0,
    sub_t1: 0,
    sub_t2: 0,
    sub_t3: 0,
    member: 3,
    vip: 0,
    moderator: 7,
  },
  chatKeyword: "!enter",
  pageEntry: false,
}

const chatPagePath = "/youtube/v3/liveChat/messages"

export function youtubeScenarios(context: ContractContext): void {
  scenario(context, "a streamer signs in with YouTube as their channel", async (world) => {
    const target = await world.start()
    const streamer = await world.signInYouTubeStreamer(target)

    const session = await (await streamer.request("/api/session")).json()
    const viewerStart = await fetch(new URL("/auth/youtube/viewer/start?giveaway=X", target.url), {
      redirect: "manual",
    })

    expect(session.streamer).toMatchObject({
      login: "contract_streamer",
      displayName: "Contract Streamer",
      platform: "youtube",
      capabilities: { pageEntry: false, chatEntry: true, followerCheck: false, vip: false },
    })
    expect(session.signInPlatforms).toContain("youtube")
    expect(viewerStart.status).toBe(404)
  })

  scenario(context, "a Google account without a YouTube channel is refused", async (world) => {
    const target = await world.start()
    world.youtube.fake.control.signInAs(null)
    const streamer = new Browser(target.url)

    const start = await streamer.request("/auth/youtube/streamer/start")
    const consent = await fetch(start.headers.get("location") ?? "", { redirect: "manual" })
    const callback = new URL(consent.headers.get("location") ?? "")
    const response = await streamer.request(callback.pathname + callback.search)

    expect(callback.pathname).toBe("/auth/youtube/callback")
    expect(response.headers.get("location")).toBe("/?signin=no-channel")
  })

  scenario(
    context,
    "a YouTube chat keyword enters members and moderators with their tickets, and reading stops at the close",
    async (world) => {
      const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
      const { control } = world.youtube.fake
      control.goLive(youtubeChannels.streamer.id)
      const giveaway = await youtubeGiveaway(world, target)
      await world.waitFor(() => chatPageCalls(world) >= 1, "the first YouTube chat read")
      const broadcaster = youtubeChannels.streamer.id

      control.sendChatMessage(broadcaster, youtubeChannels.viewer.id, "!enter", { member: true })
      control.sendChatMessage(broadcaster, youtubeChannels.viewer2.id, "!Enter me", {
        moderator: true,
      })
      control.sendChatMessage(broadcaster, youtubeChannels.viewer3.id, "gg")
      await world.waitFor(
        async () => (await world.live(giveaway)).entrantCount === 2,
        "the two keyword chatters to enter",
      )
      await world.closeGiveaway(giveaway)
      const readsAtClose = chatPageCalls(world)
      await Bun.sleep(2500)

      expect(
        (await entrants(giveaway)).map(({ login, group, tickets }) => ({ login, group, tickets })),
      ).toEqual([
        { login: "contract_viewer", group: "member", tickets: 3 },
        { login: "contract_viewer2", group: "moderator", tickets: 7 },
      ])
      expect(chatPageCalls(world)).toBeLessThanOrEqual(readsAtClose + 1)
    },
  )

  scenario(context, "a YouTube winner claims by writing in chat", async (world) => {
    const target = await world.start({ CHAT_ENTRY_CHECK_SECONDS: "1" })
    const { control } = world.youtube.fake
    const broadcaster = youtubeChannels.streamer.id
    control.goLive(broadcaster)
    const giveaway = await youtubeGiveaway(world, target)
    await world.waitFor(() => chatPageCalls(world) >= 1, "the first YouTube chat read")
    control.sendChatMessage(broadcaster, youtubeChannels.viewer.id, "!enter")
    await world.waitFor(
      async () => (await world.live(giveaway)).entrantCount === 1,
      "the chatter to enter",
    )
    await world.closeGiveaway(giveaway)
    expect((await world.drawWinners(giveaway)).status).toBe(200)
    const reads = chatPageCalls(world)
    await world.waitFor(() => chatPageCalls(world) > reads, "the winner chat watch to read")

    control.sendChatMessage(broadcaster, youtubeChannels.viewer.id, "here!")
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "claimed",
      "the YouTube chat message to claim",
    )

    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "chat",
    })
  })

  scenario(
    context,
    "a YouTube giveaway whose chat watch would pass the day's units is refused, and the admin page counts them",
    async (world) => {
      // A minute of chat reads at one per second costs 300 units, five minutes of claim reads 50, the sign-in 2.
      const target = await world.start({
        YOUTUBE_DAILY_QUOTA_UNITS: "352",
        YOUTUBE_WINNER_POLL_MIN_MS: "30000",
      })
      const streamer = await world.signInYouTubeStreamer(target)

      const fits = await streamer.postJson("/api/dash/giveaways", {
        rules: { ...defaultRules, ...youtubeRules },
      })
      const tooLong = await streamer.postJson("/api/dash/giveaways", {
        rules: { ...defaultRules, ...youtubeRules },
        closesAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      const budget = await (await streamer.request("/api/dash/youtube-budget")).json()
      const admin = await world.signInStreamer(target)
      const usage = await (await admin.request("/api/admin/usage")).json()

      expect(fits.status).toBe(201)
      expect(tooLong.status).toBe(409)
      expect(await tooLong.json()).toMatchObject({ error: "youtube-quota", needed: 3050 })
      expect(budget).toMatchObject({ limit: 352, unitsPerMinute: 300, winnerUnitsPerMinute: 10 })
      expect(usage.youtubeQuota).toMatchObject({ limit: 352, alert: false })
      expect(usage.youtubeQuota.used).toBeGreaterThanOrEqual(1)
    },
  )
}

async function youtubeGiveaway(world: World, target: ContractTarget): Promise<CreatedGiveaway> {
  const streamer = await world.signInYouTubeStreamer(target)
  return world.createGiveaway(target, { streamer, rules: youtubeRules })
}

async function entrants(giveaway: CreatedGiveaway): Promise<readonly Entrant[]> {
  const response = await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants`)
  const body: { rows: Entrant[] } = await response.json()
  return body.rows
}

function chatPageCalls(world: World): number {
  return world.youtube.fake.control.calls.filter((call) => call.path === chatPagePath).length
}
