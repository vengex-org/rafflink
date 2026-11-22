import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Giveaway } from "../accounts/account-store.ts"
import type { Actor } from "../domain/actor.ts"
import { errorClass } from "../lib/error-class.ts"
import { providerFor } from "../platform/provider.ts"
import type { ClaimOutcome, DrawOutcome, RerollOutcome } from "../room/giveaway-room.ts"
import { mirrorStatus } from "../room/mirror-status.ts"
import type { AppDeps } from "./deps.ts"
import { objectField, readJson, type BadgesJson, type EntrantsPage } from "./json.ts"

/**
 * The live page's buttons and lists, shared by the streamer's routes and a moderator link's: the caller has
 * found the giveaway and decided who may act; `by` is who the room records as the actor.
 */
export async function closeEntries(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
  by: Actor,
): Promise<Response> {
  const outcome = await deps.rooms.get(giveaway.id).close(by)
  switch (outcome.kind) {
    case "closed":
      await mirrorStatus(
        deps.rooms.get(giveaway.id),
        deps.accounts,
        giveaway.id,
        "closed",
        deps.clock.now(),
      )
      return c.json({ kind: "closed" })
    case "not-open":
      return c.json({ kind: "not-open", status: outcome.status }, 409)
  }
}

/**
 * Draws the next `count` winners at once. While entries are open the press closes them and asks the room to
 * draw the first batch itself once the committed drand round is published.
 */
export async function drawWinner(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
  by: Actor,
): Promise<Response> {
  const count = integerField(await readJson(c), "count", 1)
  if (count === null || count > deps.config.drawMaxWinners) {
    return c.json({ error: "invalid-input", field: "count" }, 400)
  }
  const room = deps.rooms.get(giveaway.id)
  const answer = async (outcome: DrawOutcome, retried: boolean): Promise<Response> => {
    switch (outcome.kind) {
      case "drawn":
        await mirrorStatus(room, deps.accounts, giveaway.id, "drawn", deps.clock.now())
        return c.json({ kind: "drawn", picks: outcome.winners.map((winner) => winner.n) })
      case "not-closed": {
        const requested = await room.requestDraw(count, by)
        if (requested.kind === "requested") {
          await mirrorStatus(room, deps.accounts, giveaway.id, "closed", deps.clock.now())
          return c.json({ kind: requested.kind }, 202)
        }
        // Entries closed between the two calls; the press still means a draw.
        if (retried) return c.json({ kind: requested.kind, status: requested.status }, 409)
        return answer(await room.draw(count, by), true)
      }
      case "round-pending":
        return c.json(
          { kind: outcome.kind, availableAt: outcome.availableAt, now: outcome.now },
          409,
        )
      case "beacon-unavailable":
        return c.json({ kind: outcome.kind }, 503)
      case "entries-deleted":
      case "no-entrants-left":
      case "pick-limit":
      case "try-again":
        return c.json({ kind: outcome.kind }, 409)
    }
  }
  return answer(await room.draw(count, by), false)
}

export async function rerollPick(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
  by: Actor,
): Promise<Response> {
  const n = integerField(await readJson(c), "n", 0)
  if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
  const outcome = await deps.rooms.get(giveaway.id).reroll(n, by)
  return c.json(
    outcome.kind === "rerolled"
      ? { kind: outcome.kind, replaced: outcome.replaced, n: outcome.winner.n }
      : { kind: outcome.kind },
    rerollStatus[outcome.kind],
  )
}

export async function markClaimed(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
  by: Actor,
): Promise<Response> {
  const n = integerField(await readJson(c), "n", 0)
  if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
  const room = deps.rooms.get(giveaway.id)
  const pick = (await room.picks()).find((item) => item.n === n)
  if (pick === undefined) return c.json({ kind: "not-a-winner" }, manualClaimStatus["not-a-winner"])
  const outcome = await room.claim(
    n,
    { platform: pick.platform, platformUserId: pick.platformUserId },
    "manual",
    by,
  )
  return c.json({ kind: outcome.kind }, manualClaimStatus[outcome.kind])
}

export async function entrantsPage(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
): Promise<Response> {
  const afterSeq = integerQuery(c.req.query("after"), 0, 0)
  if (afterSeq === null) return c.json({ error: "invalid-input", field: "after" }, 400)
  const requested = integerQuery(c.req.query("limit"), deps.config.entrantsPageMax, 1)
  if (requested === null) return c.json({ error: "invalid-input", field: "limit" }, 400)
  const limit = Math.min(requested, deps.config.entrantsPageMax)
  // One row more than the page tells whether another page follows.
  const rows = await deps.rooms.get(giveaway.id).entrants({ afterSeq, limit: limit + 1 })
  const body: EntrantsPage = { rows: rows.slice(0, limit), more: rows.length > limit }
  c.header("Cache-Control", "no-store")
  return c.json(body)
}

// No room is involved, so a giveaway whose room is unreachable still gets its badges.
export async function subscriberBadges(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
): Promise<Response> {
  const body: BadgesJson = await providerFor(deps.platforms, giveaway.platform).subscriberBadges(
    giveaway.broadcasterId,
  )
  c.header("Cache-Control", "no-store")
  return c.json(body)
}

/** Sets the room up from the account row; false, logged, when the room did not answer. Creation may have written the row and lost the room call, so every route that acts on a room calls it first. */
export async function initRoom(deps: AppDeps, giveaway: Giveaway): Promise<boolean> {
  try {
    await deps.rooms.get(giveaway.id).init({
      id: giveaway.id,
      platform: giveaway.platform,
      broadcasterId: giveaway.broadcasterId,
      title: giveaway.title,
      code: giveaway.code,
      rules: giveaway.rules,
      claimSeconds: giveaway.claimSeconds,
      closesAt: giveaway.closesAt,
      winnerCount: giveaway.winnerCount,
    })
    return true
  } catch (error) {
    console.warn("room init failed", { giveawayId: giveaway.id, errorClass: errorClass(error) })
    return false
  }
}

export function integerField(body: unknown, field: string, min: number): number | null {
  const value = objectField(body, field)
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : null
}

// A query value that is a whole number from `min` up, or `fallback` when absent; null when it is anything else.
export function integerQuery(
  raw: string | undefined,
  fallback: number,
  min: number,
): number | null {
  if (raw === undefined) return fallback
  const value = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value >= min ? value : null
}

const rerollStatus: Readonly<Record<RerollOutcome["kind"], ContentfulStatusCode>> = {
  rerolled: 200,
  "unknown-pick": 404,
  "already-rerolled": 409,
  "already-claimed": 409,
  "not-drawn": 409,
  "no-entrants-left": 409,
  "entries-deleted": 409,
  "reroll-window-over": 409,
  "try-again": 409,
}

const manualClaimStatus: Readonly<Record<ClaimOutcome["kind"], ContentfulStatusCode>> = {
  claimed: 200,
  "not-a-winner": 404,
  "already-claimed": 409,
  expired: 409,
  rerolled: 409,
}
