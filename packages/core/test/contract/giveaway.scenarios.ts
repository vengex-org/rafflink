import { expect } from "bun:test"
import { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { publicOrigin, scenario, type CreatedGiveaway } from "./world.ts"

export function giveawayScenarios(context: ContractContext): void {
  scenario(
    context,
    "the giveaway page carries the entry poll timing from the config",
    async (world) => {
      const target = await world.start({ QUEUE_POLL_SECONDS: "2", QUEUE_POLL_MAX_SECONDS: "60" })
      const giveaway = await world.createGiveaway(target)

      const page = await (await fetch(new URL(`/api/g/${giveaway.code}`, target.url))).json()

      expect(page.poll).toEqual({ intervalMs: 2000, maxMs: 60_000 })
    },
  )

  scenario(
    context,
    "the giveaway page carries the viewer state and reuses its public part for the cache time",
    async (world) => {
      const target = await world.start({ PUBLIC_GIVEAWAY_CACHE_SECONDS: "2" })
      const giveaway = await world.createGiveaway(target)
      const anonymous = async () => {
        const response = await fetch(new URL(`/api/g/${giveaway.code}`, target.url))
        const page: { entrantCount: number; me: { kind: string } } = await response.json()
        return { page, cacheControl: response.headers.get("cache-control") }
      }
      const first = await anonymous()

      const entered = await world.enter(target, giveaway.code, users.viewer.id)
      const stale = await anonymous()
      const own: { entrantCount: number; me: { kind: string } } = await (
        await entered.viewer.request(`/api/g/${giveaway.code}`)
      ).json()

      expect(first.page).toMatchObject({ entrantCount: 0, me: { kind: "signed-out" } })
      expect(first.cacheControl).toBe("no-store")
      expect(stale.page.entrantCount).toBe(0)
      expect(own).toMatchObject({ entrantCount: 1, me: { kind: "entered" } })
      await world.waitFor(
        async () => (await anonymous()).page.entrantCount === 1,
        "the cached public part to expire",
      )
    },
  )

  scenario(context, "the giveaway page names the streamer by display name", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)

    const page = await (await fetch(new URL(`/api/g/${giveaway.code}`, target.url))).json()

    expect(page).toMatchObject({ streamerName: users.streamer.displayName })
  })

  scenario(context, "a giveaway without a title and a prize shows neither", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target, { unnamed: true })

    const page = await (await fetch(new URL(`/api/g/${giveaway.code}`, target.url))).json()

    expect(page).toMatchObject({ title: null, prize: null })
    expect(await world.live(giveaway)).toMatchObject({ title: null })
  })

  scenario(context, "entries are refused after the streamer closes the giveaway", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)

    const closed = await world.closeGiveaway(giveaway)
    const result = await world.enter(target, giveaway.code, users.viewer.id)

    expect(closed.status).toBe(200)
    expect(result.entry).toBe("closed")
    expect(await world.live(giveaway)).toMatchObject({ status: "closed", entrantCount: 0 })
  })

  scenario(context, "entries are refused after the end time", async (world) => {
    const target = await world.start()
    const streamer = await world.signInStreamer(target)
    const giveaway = await world.createGiveaway(target, {
      streamer,
      closesAt: new Date(Date.now() + 2000),
    })

    await world.waitFor(
      async () => (await publicStatus(target, giveaway)) === "closed",
      "the end time to close the giveaway",
    )
    const result = await world.enter(target, giveaway.code, users.viewer.id)

    expect(result.entry).toBe("closed")
    expect(await world.live(giveaway)).toMatchObject({ entrantCount: 0 })
  })

  scenario(
    context,
    "pressing Draw while entries are open closes them and the room draws the first winner once the round is published",
    async (world) => {
      const target = await world.start({ DRAND_LEAD_SECONDS: "3" })
      const giveaway = await world.createGiveaway(target)
      for (const viewer of [users.viewer, users.viewer2, users.viewer3]) {
        await world.enter(target, giveaway.code, viewer.id)
      }
      // The socket carries every state change, so the scenario waits for pushes instead of polling the room.
      const { messages } = world.openSocket(new URL(`/api/live/${giveaway.id}`, target.url), {
        cookie: giveaway.streamer.cookieHeader(),
        origin: publicOrigin,
      })
      await world.waitFor(() => messages.length >= 1, "the first snapshot")

      const requested = await world.drawWinners(giveaway)
      await world.waitFor(
        () =>
          messages.some((message) => message.status === "drawn" && message.winners.length === 1),
        "the room to draw by itself",
      )

      expect(requested.status).toBe(202)
      expect(await requested.json()).toEqual({ kind: "requested" })
      expect(messages.find((message) => message.status === "closed")).toMatchObject({
        drawRequested: true,
      })
      expect(messages.at(-1)).toMatchObject({ status: "drawn", drawRequested: false })
    },
  )

  scenario(
    context,
    "each press of Draw adds one distinct winner, past the planned count, until nobody is left",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target, { winnerCount: 1 })
      const entered = [users.viewer, users.viewer2]
      for (const viewer of entered) await world.enter(target, giveaway.code, viewer.id)
      await world.closeGiveaway(giveaway)

      const first = await world.drawWinners(giveaway)
      const second = await world.drawWinners(giveaway)
      const third = await world.drawWinners(giveaway)

      expect(await first.json()).toEqual({ kind: "drawn", picks: [0] })
      expect(await second.json()).toEqual({ kind: "drawn", picks: [1] })
      const winners = (await world.live(giveaway)).winners.map((winner) => winner.displayName)
      expect(new Set(winners).size).toBe(2)
      expect(entered.map((viewer) => viewer.displayName)).toEqual(expect.arrayContaining(winners))
      expect(third.status).toBe(409)
      expect(await third.json()).toEqual({ kind: "no-entrants-left" })
    },
  )

  scenario(context, "a reroll marks the winner rerolled and adds the next pick", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    for (const viewer of [users.viewer, users.viewer2, users.viewer3]) {
      await world.enter(target, giveaway.code, viewer.id)
    }
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway)

    const rerolled = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/reroll`, {
      n: 0,
    })

    expect(rerolled.status).toBe(200)
    expect(await rerolled.json()).toEqual({ kind: "rerolled", replaced: 0, n: 1 })
    const [first, next] = (await world.live(giveaway)).winners
    expect(first).toMatchObject({ n: 0, claim: { state: "rerolled" } })
    expect(next).toMatchObject({ n: 1, claim: { state: "waiting" } })
    expect(next?.displayName).not.toBe(first?.displayName)
  })

  scenario(context, "the Claim button records the claim as rafflink", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target, { claimSeconds: 120 })
    const entered = await world.enter(target, giveaway.code, users.viewer.id)
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway)

    const { me }: { me: { claimRemainingMs: number } } = await (
      await entered.viewer.request(`/api/g/${giveaway.code}`)
    ).json()
    const claimStart = Date.now()
    const claimed = await entered.viewer.postJson(`/api/g/${giveaway.code}/claim`, {})

    expect(me).toMatchObject({
      kind: "won",
      n: 0,
      entry: { tickets: 1, group: "viewer" },
      claim: { state: "waiting" },
    })
    expect(me.claimRemainingMs).toBeGreaterThan(0)
    expect(me.claimRemainingMs).toBeLessThanOrEqual(120_000)
    expect(claimed.status).toBe(200)
    expect(await claimed.json()).toEqual({ kind: "claimed" })
    const claim = (await world.live(giveaway)).winners[0]?.claim
    expect(claim).toMatchObject({ state: "claimed", via: "rafflink" })
    const claimedAt = claim?.state === "claimed" ? claim.at : Number.NaN
    expect(claimedAt).toBeGreaterThanOrEqual(claimStart)
    expect(claimedAt).toBeLessThanOrEqual(Date.now())
  })

  scenario(
    context,
    "a returning viewer sees the entry and then the result from the cookie alone",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const winner = await world.enter(target, giveaway.code, users.viewer.id)
      const loser = await world.enter(target, giveaway.code, users.viewer2.id)
      const stranger = new Browser(target.url)
      const meOf = async (browser: Browser): Promise<{ kind: string }> => {
        const page: { me: { kind: string } } = await (
          await browser.request(`/api/g/${giveaway.code}`)
        ).json()
        return page.me
      }

      const entered = await meOf(winner.viewer)
      const signedOut = await meOf(stranger)
      await world.closeGiveaway(giveaway)
      await world.drawWinners(giveaway)
      const results = [await meOf(winner.viewer), await meOf(loser.viewer)]

      expect(entered).toMatchObject({ kind: "entered", entry: { group: "viewer", tickets: 1 } })
      expect(signedOut).toEqual({ kind: "signed-out" })
      expect(results.map((result) => result.kind).toSorted()).toEqual(["not-won", "won"])
    },
  )

  scenario(context, "a claim after the claim time is refused", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target, { claimSeconds: 1 })
    const entered = await world.enter(target, giveaway.code, users.viewer.id)
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway)

    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "expired",
      "the claim time to pass",
    )
    const claimed = await entered.viewer.postJson(`/api/g/${giveaway.code}/claim`, {})

    expect(claimed.status).toBe(409)
    expect(await claimed.json()).toEqual({ kind: "expired" })
  })

  scenario(context, "the streamer marks a claim by hand", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    await world.enter(target, giveaway.code, users.viewer.id)
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway)

    const marked = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
      n: 0,
    })

    expect(marked.status).toBe(200)
    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "manual",
    })
  })

  scenario(context, "the streamer marks a claim by hand after the claim time", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target, { claimSeconds: 1 })
    await world.enter(target, giveaway.code, users.viewer.id)
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway)
    await world.waitFor(
      async () => (await world.live(giveaway)).winners[0]?.claim.state === "expired",
      "the claim time to pass",
    )

    const marked = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
      n: 0,
    })

    expect(marked.status).toBe(200)
    expect(await marked.json()).toEqual({ kind: "claimed" })
    expect((await world.live(giveaway)).winners[0]?.claim).toMatchObject({
      state: "claimed",
      via: "manual",
    })
  })

  scenario(context, "another streamer gets 404 on a giveaway that is not theirs", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    await world.enter(target, giveaway.code, users.viewer.id)
    const other = await world.signInStreamer(target, users.otherStreamer.id)

    const attempts = [
      await other.postJson(`/api/dash/giveaways/${giveaway.id}/close`, {}),
      await other.postJson(`/api/dash/giveaways/${giveaway.id}/draw`, { count: 1 }),
      await other.postJson(`/api/dash/giveaways/${giveaway.id}/reroll`, { n: 0 }),
      await other.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, { n: 0 }),
      await other.request(`/api/live/${giveaway.id}`),
    ]

    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404, 404])
    expect(await publicStatus(target, giveaway)).toBe("open")
  })
}

async function publicStatus(target: ContractTarget, giveaway: CreatedGiveaway): Promise<string> {
  const response = await fetch(new URL(`/api/g/${giveaway.code}`, target.url))
  const body: { status: string } = await response.json()
  return body.status
}
