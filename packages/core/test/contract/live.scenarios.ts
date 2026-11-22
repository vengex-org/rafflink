import { expect } from "bun:test"
import { globalSubscriberBadgeUrl } from "@rafflink/fake-twitch"
import { defaultOverlayTheme, type OverlayTheme } from "../../src/domain/overlay-theme.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { moderatorsPath, publicOrigin, scenario, vipsPath, type World } from "./world.ts"

const upgrade = { upgrade: "websocket", connection: "Upgrade" }

export function liveScenarios(context: ContractContext): void {
  scenario(context, "a viewer on the VIP list enters with the VIP tickets", (world) =>
    expectRoleTickets(world, "vip", vipsPath, 6),
  )

  scenario(context, "a viewer on the moderator list enters with the moderator tickets", (world) =>
    expectRoleTickets(world, "moderator", moderatorsPath, 7),
  )

  scenario(context, "a failed role refresh is counted in the live JSON", async (world) => {
    const target = await world.start()
    world.twitch.fake.control.failNext("vips", 503, 2)
    const giveaway = await world.createGiveaway(target)

    await world.waitFor(
      async () => (await world.live(giveaway)).roleRefreshFailures >= 1,
      "the role refresh failure to be counted",
    )

    expect(await world.live(giveaway)).toMatchObject({
      roleRefreshFailures: 1,
      eventSubFailures: 0,
    })
  })

  scenario(context, "the live WebSocket pushes a snapshot after an entry", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const { messages } = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
      cookie: giveaway.streamer.cookieHeader(),
      origin: publicOrigin,
    })
    await world.waitFor(() => messages.length >= 1, "the first snapshot")

    await world.enter(target, giveaway.code, users.viewer.id)
    await world.waitFor(
      () => messages.some((message) => message.entrantCount === 1),
      "the snapshot after the entry",
    )

    expect(messages[0]).toMatchObject({
      entrantCount: 0,
      lastNames: [],
      title: "Giveaway",
      code: giveaway.code,
    })
    expect(messages.at(-1)).toMatchObject({
      entrantCount: 1,
      ticketTotal: 1,
      lastNames: [users.viewer.displayName],
    })
  })

  scenario(
    context,
    "the entrants list pages by sequence number and belongs to the owner",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      for (const viewer of [users.viewer, users.viewer2, users.viewer3]) {
        await world.enter(target, giveaway.code, viewer.id)
      }
      const other = await world.signInStreamer(target, users.otherStreamer.id)

      const all = await (
        await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants`)
      ).json()
      const second = await (
        await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants?after=1&limit=1`)
      ).json()
      const refused = await other.request(`/api/live/${giveaway.id}/entrants`)
      const anonymous = await fetch(new URL(`/api/live/${giveaway.id}/entrants`, target.url))

      expect(all).toEqual({
        more: false,
        rows: [users.viewer, users.viewer2, users.viewer3].map((viewer, index) => ({
          seq: index + 1,
          login: viewer.login,
          displayName: viewer.displayName,
          tickets: 1,
          group: "viewer",
          profileImageUrl: viewer.profileImageUrl,
        })),
      })
      expect(second).toMatchObject({ more: true, rows: [{ seq: 2, login: users.viewer2.login }] })
      expect(refused.status).toBe(404)
      expect(anonymous.status).toBe(401)
    },
  )

  scenario(
    context,
    "the badges route gives the owner the channel's subscriber badges and reads Twitch once",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const tier2 = "https://static-cdn.jtvnw.net/badges/v1/tier2/2"
      world.twitch.fake.control.setChannelSubscriberBadges(users.streamer.id, { "2000": tier2 })
      const other = await world.signInStreamer(target, users.otherStreamer.id)

      const first = await giveaway.streamer.request(`/api/live/${giveaway.id}/badges`)
      const second = await giveaway.streamer.request(`/api/live/${giveaway.id}/badges`)
      const refused = await other.request(`/api/live/${giveaway.id}/badges`)
      const anonymous = await fetch(new URL(`/api/live/${giveaway.id}/badges`, target.url))

      expect(await first.json()).toEqual({
        sub_t1: globalSubscriberBadgeUrl,
        sub_t2: tier2,
        sub_t3: globalSubscriberBadgeUrl,
      })
      expect(await second.json()).toMatchObject({ sub_t2: tier2 })
      expect(
        world.twitch.fake.control.calls.filter((call) => call.path === "/helix/chat/badges"),
      ).toHaveLength(1)
      expect(refused.status).toBe(404)
      expect(anonymous.status).toBe(401)
    },
  )

  scenario(
    context,
    "the live WebSocket pushes the entrants written since its previous push",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const { messages } = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
        cookie: giveaway.streamer.cookieHeader(),
        origin: publicOrigin,
      })
      await world.waitFor(() => messages.length >= 1, "the first snapshot")

      await world.enter(target, giveaway.code, users.viewer.id)
      await world.enter(target, giveaway.code, users.viewer2.id)
      await world.waitFor(
        () => messages.some((message) => message.entrantCount === 2),
        "the push after the second entry",
      )

      expect(messages[0]?.entrantsAfter).toBeUndefined()
      expect(messages.find((message) => message.entrantCount === 2)?.entrantsAfter).toEqual({
        fromSeq: 1,
        truncated: false,
        rows: [
          {
            seq: 2,
            login: users.viewer2.login,
            displayName: users.viewer2.displayName,
            tickets: 1,
            group: "viewer",
            profileImageUrl: users.viewer2.profileImageUrl,
          },
        ],
      })
    },
  )

  // The interval is long enough that the two entries after the first push land in one push.
  scenario(
    context,
    "a push with more new entrants than it carries is truncated and the list fills the gap",
    async (world) => {
      const target = await world.start({
        LIVE_INTERVAL_MS: "2000",
        LIVE_ENTRANTS_PER_PUSH: "1",
      })
      const giveaway = await world.createGiveaway(target)
      const { messages } = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
        cookie: giveaway.streamer.cookieHeader(),
        origin: publicOrigin,
      })
      await world.waitFor(() => messages.length >= 1, "the first snapshot")
      await world.enter(target, giveaway.code, users.viewer.id)
      await world.enter(target, giveaway.code, users.viewer2.id)
      await world.enter(target, giveaway.code, users.viewer3.id)

      await world.waitFor(
        () => messages.some((message) => message.entrantCount === 3),
        "the push with both new entrants",
      )

      const push = messages.find((message) => message.entrantCount === 3)?.entrantsAfter
      expect(push).toMatchObject({ fromSeq: 1, truncated: true })
      expect(push?.rows.map((row) => row.seq)).toEqual([2])
      const gap = await (
        await giveaway.streamer.request(`/api/live/${giveaway.id}/entrants?after=${push?.fromSeq}`)
      ).json()
      expect(gap.rows.map((row: { seq: number }) => row.seq)).toEqual([2, 3])

      await world.enter(target, giveaway.code, users.newViewer.id)
      await world.waitFor(
        () => messages.some((message) => message.entrantCount === 4),
        "the push after the truncated one",
      )
      const next = messages.find((message) => message.entrantCount === 4)?.entrantsAfter
      expect(next).toMatchObject({ fromSeq: 3, truncated: false })
      expect(next?.rows.map((row) => row.seq)).toEqual([4])
    },
  )

  scenario(
    context,
    "the overlay with a valid token shows the live view read-only",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await world.enter(target, giveaway.code, users.viewer.id)
      const overlay = new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url)

      const read = await fetch(overlay)
      const write = await fetch(overlay, { method: "POST" })

      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({ status: "open", entrantCount: 1 })
      expect(write.status).toBe(404)
    },
  )

  scenario(context, "the overlay socket gets a style the streamer saves", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const overlay = world.openSocket<{ readonly theme?: OverlayTheme }>(
      new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url),
    )
    await world.waitFor(() => overlay.messages.length >= 1, "the first overlay snapshot")
    const theme: OverlayTheme = { ...defaultOverlayTheme, accent: "#ff5500" }

    const saved = await giveaway.streamer.postJson("/api/dash/overlay-theme", theme)

    expect(saved.status).toBe(200)
    await world.waitFor(
      () => overlay.messages.some((message) => message.theme?.accent === "#ff5500"),
      "the style push on the overlay socket",
    )
    expect(overlay.messages.at(-1)).toEqual({ theme })
  })

  scenario(
    context,
    "the owner's live JSON carries the overlay token and the support link and the overlay's does not",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)

      const owner = await (await giveaway.streamer.request(`/api/live/${giveaway.id}`)).json()
      const overlay = await (
        await fetch(new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url))
      ).json()

      expect(owner.overlayToken).toBe(giveaway.overlayToken)
      expect(owner.donateUrl).toBeNull()
      expect(overlay.overlayToken).toBeUndefined()
      expect(overlay.donateUrl).toBeUndefined()
    },
  )

  scenario(
    context,
    "a WebSocket upgrade from another origin is refused on the live and overlay routes",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const live = new URL(`/api/live/${giveaway.id}`, target.url)
      const overlay = new URL(`/api/overlay/${giveaway.id}/${giveaway.overlayToken}`, target.url)
      const cookie = giveaway.streamer.cookieHeader()
      const evil = { ...upgrade, origin: "https://evil.example" }

      const statuses = [
        (await fetch(live, { headers: { ...evil, cookie } })).status,
        (await fetch(live, { headers: { ...upgrade, cookie } })).status,
        (await fetch(overlay, { headers: evil })).status,
      ]
      const { messages } = world.openSocket(overlay)

      expect(statuses).toEqual([403, 403, 403])
      await world.waitFor(
        () => messages.length >= 1,
        "the overlay snapshot without an Origin header",
      )
    },
  )

  scenario(context, "the overlay with a wrong token answers 404", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const wrong = `${giveaway.overlayToken.slice(0, -1)}${giveaway.overlayToken.endsWith("0") ? "1" : "0"}`

    const response = await fetch(new URL(`/api/overlay/${giveaway.id}/${wrong}`, target.url))

    expect(response.status).toBe(404)
  })
}

// The room refreshes roles on its alarm. A refresh that starts after the role was set has finished once
// the next refresh asks Twitch again, so the viewer only enters after two more calls.
async function expectRoleTickets(
  world: World,
  role: "vip" | "moderator",
  path: string,
  tickets: number,
): Promise<void> {
  const target: ContractTarget = await world.start({ ROLE_REFRESH_SECONDS: "1" })
  const giveaway = await world.createGiveaway(target)
  world.twitch.fake.control.setRole(users.streamer.id, users.viewer.id, role, true)
  const callsWhenSet = world.twitchCalls(path)
  await world.waitFor(
    () => world.twitchCalls(path) >= callsWhenSet + 2,
    `two role refreshes after the ${role} was set`,
  )

  const result = await world.enter(target, giveaway.code, users.viewer.id)

  expect(result.entry).toBe("entered")
  expect(await world.live(giveaway)).toMatchObject({ entrantCount: 1, ticketTotal: tickets })
}
