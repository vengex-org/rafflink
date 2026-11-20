import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { scenario, type CreatedGiveaway } from "./world.ts"

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

  scenario(context, "drawing while entries are open is refused", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    await world.enter(target, giveaway.code, users.viewer.id)

    const response = await world.drawWinners(giveaway, 1)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ kind: "not-closed" })
  })

  scenario(
    context,
    "drawing picks distinct entrants and a second draw is refused",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      const entered = [users.viewer, users.viewer2, users.viewer3]
      for (const viewer of entered) await world.enter(target, giveaway.code, viewer.id)
      await world.closeGiveaway(giveaway)

      const drawn = await world.drawWinners(giveaway, 2)
      const again = await world.drawWinners(giveaway, 1)

      expect(drawn.status).toBe(200)
      expect(await drawn.json()).toEqual({ kind: "drawn", winners: [0, 1] })
      const winners = (await world.live(giveaway)).winners.map((winner) => winner.displayName)
      expect(new Set(winners).size).toBe(2)
      expect(entered.map((viewer) => viewer.displayName)).toEqual(expect.arrayContaining(winners))
      expect(again.status).toBe(409)
      expect(await again.json()).toEqual({ kind: "already-drawn" })
    },
  )

  scenario(context, "a reroll marks the winner rerolled and adds the next pick", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    for (const viewer of [users.viewer, users.viewer2, users.viewer3]) {
      await world.enter(target, giveaway.code, viewer.id)
    }
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway, 1)

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
    await world.drawWinners(giveaway, 1)

    const page: { win: { n: number; claimRemainingMs: number; claim: { state: string } } } = await (
      await entered.viewer.request(`/api/g/${giveaway.code}`)
    ).json()
    const claimed = await entered.viewer.postJson(`/api/g/${giveaway.code}/claim`, {})

    expect(page.win).toMatchObject({ n: 0, claim: { state: "waiting" } })
    expect(page.win.claimRemainingMs).toBeGreaterThan(0)
    expect(page.win.claimRemainingMs).toBeLessThanOrEqual(120_000)
    expect(claimed.status).toBe(200)
    expect(await claimed.json()).toEqual({ kind: "claimed" })
    expect((await world.live(giveaway)).winners[0]?.claim).toEqual({
      state: "claimed",
      via: "rafflink",
    })
  })

  scenario(context, "a claim after the claim time is refused", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target, { claimSeconds: 1 })
    const entered = await world.enter(target, giveaway.code, users.viewer.id)
    await world.closeGiveaway(giveaway)
    await world.drawWinners(giveaway, 1)

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
    await world.drawWinners(giveaway, 1)

    const marked = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/claim`, {
      n: 0,
    })

    expect(marked.status).toBe(200)
    expect((await world.live(giveaway)).winners[0]?.claim).toEqual({
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
