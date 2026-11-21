import { Hono, type Context, type MiddlewareHandler } from "hono"
import { timingSafeEqual } from "hono/utils/buffer"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Giveaway, NewGiveaway } from "../accounts/account-store.ts"
import { generateCode } from "../lib/codes.ts"
import { errorClass } from "../lib/error-class.ts"
import { randomId } from "../lib/random-id.ts"
import { UsageUnavailable } from "../lib/usage-unavailable.ts"
import type { Usage } from "../ports.ts"
import {
  overlaySnapshot,
  type ClaimOutcome,
  type DrawOutcome,
  type RerollOutcome,
} from "../room/giveaway-room.ts"
import { mirrorStatus } from "../room/mirror-status.ts"
import { ChannelBadges } from "../twitch/channel-badges.ts"
import { parseCreateGiveaway, parseWinnerCount } from "./create-input.ts"
import type { AppDeps } from "./deps.ts"
import {
  dashboardGiveaway,
  readJson,
  type BadgesJson,
  type EntrantsPage,
  type OwnerLiveSnapshot,
} from "./json.ts"
import type { StreamerSession } from "./session.ts"
import { currentStreamer } from "./session-routes.ts"
import { webSocketOrigin } from "./websocket-origin.ts"

type Env = { Variables: { streamer: StreamerSession } }

export function dashboardRoutes(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>()
  const badges = new ChannelBadges(deps.twitch, deps.clock, deps.config)

  app.use("/api/live/:id", webSocketOrigin(deps.config, { allowMissing: false }))
  app.use("/api/overlay/:id/:token", webSocketOrigin(deps.config, { allowMissing: true }))
  app.use("/api/dash/*", requireStreamer(deps))
  app.use("/api/live/*", requireStreamer(deps))
  app.use("/api/admin/*", requireStreamer(deps))

  app.post("/api/dash/giveaways", async (c) => {
    const parsed = parseCreateGiveaway(await readJson(c), deps.clock.now(), deps.config)
    if (!parsed.ok) return c.json({ error: "invalid-input", ...parsed.issue }, 400)
    const streamer = c.get("streamer")
    const created = await insertWithFreshCode(deps, {
      id: randomId(deps.random),
      streamerId: streamer.streamerId,
      title: parsed.value.title,
      prize: parsed.value.prize,
      rules: parsed.value.rules,
      closesAt: parsed.value.closesAt,
      claimSeconds: parsed.value.claimSeconds,
      winnerCount: parsed.value.winnerCount,
      overlayToken: randomId(deps.random),
      createdAt: deps.clock.now(),
    })
    if (created === null) {
      console.warn("giveaway code retries exhausted", { streamerId: streamer.streamerId })
      return c.json({ error: "code-unavailable" }, 503)
    }
    const giveaway = await deps.accounts.findOwnedGiveaway(streamer.streamerId, created.id)
    if (giveaway === null) throw new Error("created giveaway not found")
    const roomReady = await initRoom(deps, giveaway)
    return c.json(
      { giveaway: dashboardGiveaway(giveaway), roomReady, warnings: await usageWarnings(deps) },
      201,
    )
  })

  app.get("/api/dash/giveaways", async (c) => {
    const giveaways = await deps.accounts.listGiveaways(c.get("streamer").streamerId)
    return c.json({ giveaways: giveaways.map(dashboardGiveaway) })
  })

  app.post("/api/dash/giveaways/:id/close", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const outcome = await deps.rooms.get(giveaway.id).close()
      switch (outcome.kind) {
        case "closed":
          await mirrorStatus(deps.rooms.get(giveaway.id), deps.accounts, giveaway.id, "closed")
          return c.json({ kind: "closed" })
        case "not-open":
          return c.json({ kind: "not-open", status: outcome.status }, 409)
      }
    }),
  )

  app.post("/api/dash/giveaways/:id/winners", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const body = await readJson(c)
      // Absent is not "one winner" here: a request that names no count is a bad request.
      const named =
        typeof body === "object" && body !== null && Object.hasOwn(body, "count")
          ? Reflect.get(body, "count")
          : null
      const count = parseWinnerCount(named, deps.config)
      if (!count.ok) return c.json({ error: "invalid-input", field: "count" }, 400)
      await deps.rooms.get(giveaway.id).setWinnerCount(count.value)
      return c.json({ kind: "set" })
    }),
  )

  // Draws the next winner. While entries are open the press closes them and asks the room to draw the
  // first winner itself once the committed drand round is published.
  app.post("/api/dash/giveaways/:id/draw", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const room = deps.rooms.get(giveaway.id)
      const answer = async (outcome: DrawOutcome, retried: boolean): Promise<Response> => {
        switch (outcome.kind) {
          case "drawn":
            await mirrorStatus(room, deps.accounts, giveaway.id, "drawn")
            return c.json({ kind: "drawn", n: outcome.winner.n })
          case "not-closed": {
            const requested = await room.requestDraw()
            if (requested.kind === "requested") {
              await mirrorStatus(room, deps.accounts, giveaway.id, "closed")
              return c.json({ kind: requested.kind }, 202)
            }
            // Entries closed between the two calls; the press still means a draw.
            if (retried) return c.json({ kind: requested.kind, status: requested.status }, 409)
            return answer(await room.draw(), true)
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
      return answer(await room.draw(), false)
    }),
  )

  app.post("/api/dash/giveaways/:id/reroll", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const n = integerField(await readJson(c), "n", 0)
      if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
      const outcome = await deps.rooms.get(giveaway.id).reroll(n)
      return c.json(
        outcome.kind === "rerolled"
          ? { kind: outcome.kind, replaced: outcome.replaced, n: outcome.winner.n }
          : { kind: outcome.kind },
        rerollStatus[outcome.kind],
      )
    }),
  )

  app.post("/api/dash/giveaways/:id/claim", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const n = integerField(await readJson(c), "n", 0)
      if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
      const room = deps.rooms.get(giveaway.id)
      const pick = (await room.picks()).find((item) => item.n === n)
      if (pick === undefined)
        return c.json({ kind: "not-a-winner" }, manualClaimStatus["not-a-winner"])
      const outcome = await room.claim(
        n,
        { platform: pick.platform, platformUserId: pick.platformUserId },
        "manual",
      )
      return c.json({ kind: outcome.kind }, manualClaimStatus[outcome.kind])
    }),
  )

  app.get("/api/live/:id", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const body: OwnerLiveSnapshot = {
        ...(await deps.rooms.get(giveaway.id).liveSnapshot()),
        overlayToken: giveaway.overlayToken,
      }
      return c.json(body)
    }),
  )

  app.get("/api/live/:id/entrants", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
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
    }),
  )

  app.get("/api/live/:id/badges", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const body: BadgesJson = await badges.of(giveaway.broadcasterId)
      c.header("Cache-Control", "no-store")
      return c.json(body)
    }),
  )

  app.get("/api/admin/usage", async (c) => {
    if (!(await deps.admins.isAdmin(c.get("streamer").twitchUserId))) {
      return c.json({ error: "forbidden" }, 403)
    }
    return c.json({ usage: await adminUsage(deps), queue: await deps.queue.stats() })
  })

  // OBS has no session: the token in the URL is the whole credential.
  app.get("/api/overlay/:id/:token", async (c) => {
    const giveaway = await deps.accounts.findGiveawayById(c.req.param("id"))
    if (
      giveaway === null
      || !(await timingSafeEqual(c.req.param("token"), giveaway.overlayToken))
    ) {
      return c.json({ error: "not-found" }, 404)
    }
    return c.json(overlaySnapshot(await deps.rooms.get(giveaway.id).liveSnapshot()))
  })

  return app
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

function requireStreamer(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const current = await currentStreamer(c, deps)
    if (current === null) return c.json({ error: "unauthorized" }, 401)
    c.set("streamer", current.session)
    return next()
  }
}

// Another streamer's giveaway looks like a missing one. The room is re-initialised first: creation
// may have written the account row and then lost the room call.
async function withOwnedRoom(
  c: Context<Env>,
  deps: AppDeps,
  act: (giveaway: Giveaway) => Promise<Response>,
): Promise<Response> {
  const giveaway = await deps.accounts.findOwnedGiveaway(
    c.get("streamer").streamerId,
    c.req.param("id") ?? "",
  )
  if (giveaway === null) return c.json({ error: "not-found" }, 404)
  if (!(await initRoom(deps, giveaway))) return c.json({ error: "room-unavailable" }, 503)
  return act(giveaway)
}

async function insertWithFreshCode(
  deps: AppDeps,
  giveaway: Omit<NewGiveaway, "code">,
): Promise<NewGiveaway | null> {
  for (let attempt = 0; attempt <= deps.config.codeInsertRetries; attempt++) {
    const candidate = { ...giveaway, code: generateCode(deps.random) }
    if ((await deps.accounts.insertGiveaway(candidate)) === "inserted") return candidate
  }
  return null
}

async function initRoom(deps: AppDeps, giveaway: Giveaway): Promise<boolean> {
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

type UsageWarning = { readonly kind: "worker-requests-low"; readonly remaining: number }

/** The admin page shows "unavailable" instead of failing when the usage source does not answer. */
async function adminUsage(deps: AppDeps): Promise<Usage | null | "unavailable"> {
  try {
    return await deps.usage.today()
  } catch (error) {
    warnUsageUnavailable(error)
    return "unavailable"
  }
}

async function usageWarnings(deps: AppDeps): Promise<UsageWarning[]> {
  try {
    const usage = await deps.usage.today()
    if (usage === null) return []
    const remaining = usage.workerRequests.limit - usage.workerRequests.used
    return remaining < deps.config.usageWarningThreshold
      ? [{ kind: "worker-requests-low", remaining }]
      : []
  } catch (error) {
    warnUsageUnavailable(error)
    return []
  }
}

function warnUsageUnavailable(error: unknown): void {
  console.warn("usage unavailable", {
    errorClass: errorClass(error),
    reason: error instanceof UsageUnavailable ? error.reason : null,
  })
}

function integerField(body: unknown, field: string, min: number): number | null {
  if (typeof body !== "object" || body === null) return null
  const value: unknown = Object.hasOwn(body, field) ? Reflect.get(body, field) : undefined
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : null
}

// A query value that is a whole number from `min` up, or `fallback` when absent; null when it is anything else.
function integerQuery(raw: string | undefined, fallback: number, min: number): number | null {
  if (raw === undefined) return fallback
  const value = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value >= min ? value : null
}
