import { expect } from "bun:test"
import { drawLeafPicks } from "../../src/lib/draw.ts"
import { quicknet } from "../../src/lib/drand.ts"
import { fromHex, toHex } from "../../src/lib/encoding.ts"
import { leafHash, merkleRoot } from "../../src/lib/merkle.ts"
import type { LeavesJson, MyLeafJson, VerifyJson } from "../../src/http/json.ts"
import type { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { scenario, type CreatedGiveaway, type World } from "./world.ts"

async function verifyOf(target: ContractTarget, code: string): Promise<VerifyJson> {
  const response = await fetch(new URL(`/api/g/${code}/verify`, target.url))
  expect(response.status).toBe(200)
  return response.json()
}

async function leavesOf(target: ContractTarget, code: string): Promise<LeavesJson> {
  const response = await fetch(new URL(`/api/g/${code}/leaves`, target.url))
  expect(response.status).toBe(200)
  return response.json()
}

async function myLeafOf(viewer: Browser, code: string): Promise<MyLeafJson> {
  const response = await viewer.request(`/api/g/${code}/my-leaf`)
  expect(response.status).toBe(200)
  return response.json()
}

function bytesOf(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = fromHex(hex)
  if (bytes === null) throw new Error("not hex")
  return bytes
}

async function hashOf(leaf: MyLeafJson): Promise<string> {
  return toHex(await leafHash({ ...leaf, salt: bytesOf(leaf.salt ?? "") }))
}

async function enterAndClose(world: World, target: ContractTarget, giveaway: CreatedGiveaway) {
  const viewers: Browser[] = []
  for (const user of [users.viewer, users.viewer2, users.viewer3]) {
    viewers.push((await world.enter(target, giveaway.code, user.id)).viewer)
  }
  await world.closeGiveaway(giveaway)
  await world.waitFor(
    async () => (await verifyOf(target, giveaway.code)).commitment !== null,
    "the closed giveaway to commit",
  )
  return viewers
}

export function commitmentScenarios(context: ContractContext): void {
  scenario(
    context,
    "closing commits the Merkle root and a drand round and publishes the leaves without names",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await enterAndClose(world, target, giveaway)

      const verify = await verifyOf(target, giveaway.code)
      const leavesResponse = await fetch(new URL(`/api/g/${giveaway.code}/leaves`, target.url))
      const leavesText = await leavesResponse.text()
      const leaves: LeavesJson = JSON.parse(leavesText)

      expect(verify).toMatchObject({
        status: "closed",
        entrantCount: 3,
        ticketTotal: leaves.tickets.reduce((sum, tickets) => sum + tickets, 0),
        picks: [],
      })
      expect(verify.commitment).toMatchObject({
        chainHash: quicknet.chainHash,
        genesisSeconds: quicknet.genesisSeconds,
        periodSeconds: quicknet.periodSeconds,
      })
      expect(verify.commitment?.committedAt).toBeGreaterThan(Date.now() - 60_000)
      expect(verify.winnerCount).toBe(1)
      expect(verify.commitment?.round).toBeGreaterThan(0)
      expect(leaves.hashes).toHaveLength(3)
      expect(verify.commitment?.merkleRoot).toBe(
        toHex(
          await merkleRoot(
            leaves.hashes.map((hash, index) => ({
              hash: bytesOf(hash),
              tickets: leaves.tickets[index] ?? 0,
            })),
          ),
        ),
      )
      expect(leavesResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      )
      expect(leavesText).not.toContain("user_")
      expect(leavesText).not.toContain("User_")
    },
  )

  scenario(
    context,
    "the winner count is set while entries are open and frozen by the close",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target, { winnerCount: 1 })
      const set = (count: number) =>
        giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/winners`, { count })

      const changed = await set(2)
      for (const user of [users.viewer, users.viewer2, users.viewer3]) {
        await world.enter(target, giveaway.code, user.id)
      }
      await world.closeGiveaway(giveaway)
      const late = await set(3)
      const mismatch = await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/draw`, {
        count: 3,
      })
      const drawn = await world.drawWinners(giveaway)

      expect(await changed.json()).toEqual({ kind: "set" })
      expect(late.status).toBe(409)
      expect(mismatch.status).toBe(400)
      expect(await drawn.json()).toEqual({ kind: "drawn", winners: [0, 1] })
      expect((await verifyOf(target, giveaway.code)).winnerCount).toBe(2)
    },
  )

  scenario(context, "only the entrant gets the salt behind their leaf", async (world) => {
    const target = await world.start()
    const giveaway = await world.createGiveaway(target)
    const [first, second] = await enterAndClose(world, target, giveaway)
    if (first === undefined || second === undefined) throw new Error("expected viewers")

    const mine = await myLeafOf(first, giveaway.code)
    const theirs = await myLeafOf(second, giveaway.code)
    const leaves = await leavesOf(target, giveaway.code)
    const anonymous = await fetch(new URL(`/api/g/${giveaway.code}/my-leaf`, target.url))
    const verifyText = JSON.stringify(await verifyOf(target, giveaway.code))

    expect(mine).toMatchObject({ platform: "twitch", platformUserId: users.viewer.id })
    expect(mine.salt).toHaveLength(32)
    expect(theirs.salt).not.toBe(mine.salt)
    expect(leaves.hashes).toContain(await hashOf(mine))
    expect(anonymous.status).toBe(401)
    expect(JSON.stringify(leaves) + verifyText).not.toContain(mine.salt ?? "no salt")
  })

  scenario(
    context,
    "a draw waits for the committed round and then uses its randomness",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target, { winnerCount: 2 })
      const viewers = await enterAndClose(world, target, giveaway)
      const round = (await verifyOf(target, giveaway.code)).commitment?.round ?? 0

      world.drand.mode = "not-yet"
      const early = await world.drawWinners(giveaway)
      const stillClosed = await verifyOf(target, giveaway.code)
      world.drand.mode = "published"
      const drawn = await world.drawWinners(giveaway)
      await giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/reroll`, { n: 0 })

      expect(early.status).toBe(409)
      expect(await early.json()).toMatchObject({ kind: "round-pending" })
      expect(stillClosed).toMatchObject({ status: "closed", picks: [] })
      expect(drawn.status).toBe(200)
      expect(world.drand.requested).toContain(round)
      const verify = await verifyOf(target, giveaway.code)
      const leaves = await leavesOf(target, giveaway.code)
      const expected = await drawLeafPicks(await world.drand.seedOf(round), leaves.tickets, 3)
      expect(verify.picks).toEqual(
        expected.map((pick) => ({ n: pick.n, leafIndex: pick.leafIndex, rerolled: pick.n === 0 })),
      )
      const rerolledTo = leaves.hashes[verify.picks[2]?.leafIndex ?? -1] ?? "no pick"
      const mine = await Promise.all(
        viewers.map(async (viewer) => hashOf(await myLeafOf(viewer, giveaway.code))),
      )
      expect(mine).toContain(rerolledTo)
    },
  )

  scenario(
    context,
    "a draw while the beacon is down draws nothing and a repeat draws",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)
      await enterAndClose(world, target, giveaway)

      world.drand.mode = "down"
      const failed = await world.drawWinners(giveaway)
      const stillClosed = await verifyOf(target, giveaway.code)
      world.drand.mode = "published"
      const drawn = await world.drawWinners(giveaway)

      expect(failed.status).toBe(503)
      expect(await failed.json()).toEqual({ kind: "beacon-unavailable" })
      expect(stillClosed.status).toBe("closed")
      expect(drawn.status).toBe(200)
    },
  )
}
