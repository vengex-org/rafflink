import { Hono, type Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Giveaway } from "../accounts/account-store.ts"
import type { ClaimOutcome, WinnerPick } from "../room/giveaway-room.ts"
import type { PollOutcome } from "../queue/token-queue.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"
import type { AppDeps } from "./deps.ts"
import type { PublicGiveaway, ViewerState } from "./json.ts"
import { readViewerSession, type ViewerSession } from "./session.ts"

export function giveawayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get("/api/g/:code", async (c) => {
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const summary = await deps.rooms.get(giveaway.id).summary()
    const body: PublicGiveaway = {
      code: giveaway.code,
      title: giveaway.title,
      prize: giveaway.prize,
      streamerName: giveaway.streamerName,
      rules: giveaway.rules,
      status: summary.status,
      closesAt: summary.closesAt,
      claimSeconds: giveaway.claimSeconds,
      entrantCount: summary.entrantCount,
      poll: {
        intervalMs: deps.config.queuePollSeconds * 1000,
        maxMs: deps.config.queuePollMaxSeconds * 1000,
      },
    }
    return c.json(body)
  })

  app.get("/api/g/:code/me", async (c) => {
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    c.header("Cache-Control", "no-store")
    return c.json(await viewerState(c, deps, giveaway))
  })

  app.get("/api/g/:code/pending/:ticket", async (c) => {
    const ticket = c.req.param("ticket")
    return c.json(pendingOutcome(await deps.queue.poll(ticket), ticket))
  })

  app.post("/api/g/:code/claim", async (c) => {
    const session = await readViewerSession(c, deps)
    if (session === null) return c.json({ error: "unauthorized" }, 401)
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const pick = await pickOf(deps, giveaway, session)
    if (pick === undefined) return c.json({ kind: "not-a-winner" }, claimStatus["not-a-winner"])
    const outcome = await deps.rooms
      .get(giveaway.id)
      .claim(pick.n, { platform: pick.platform, platformUserId: pick.platformUserId }, "rafflink")
    return c.json({ kind: outcome.kind }, claimStatus[outcome.kind])
  })

  return app
}

const claimStatus: Readonly<Record<ClaimOutcome["kind"], ContentfulStatusCode>> = {
  claimed: 200,
  "already-claimed": 409,
  expired: 409,
  rerolled: 409,
  "not-a-winner": 403,
}

function pendingOutcome(polled: PollOutcome, ticket: string): CallbackOutcome {
  switch (polled.kind) {
    case "waiting":
      return { kind: "pending", ticket }
    case "done":
      return polled.outcome
    case "gone":
      return { kind: "dropped" }
  }
}

// The pick is matched on the cookie's platform too, so only the winner's own platform account claims.
async function pickOf(
  deps: AppDeps,
  giveaway: Giveaway,
  session: ViewerSession,
): Promise<WinnerPick | undefined> {
  const picks = await deps.rooms.get(giveaway.id).picks()
  return picks.find(
    (pick) => pick.platform === session.platform && pick.platformUserId === session.userId,
  )
}

async function viewerState(c: Context, deps: AppDeps, giveaway: Giveaway): Promise<ViewerState> {
  const session = await readViewerSession(c, deps)
  if (session === null) return { kind: "signed-out" }
  const room = deps.rooms.get(giveaway.id)
  const summary = await room.summary()
  if (summary.status === "drawn") {
    const pick = await pickOf(deps, giveaway, session)
    if (pick !== undefined) {
      return {
        kind: "won",
        n: pick.n,
        claimRemainingMs: Math.max(0, pick.claimUntil - deps.clock.now()),
        claim: pick.claim,
        chatClaimAvailable: !summary.chatClaimUnavailable,
      }
    }
  }
  const entry = await room.entryOf({ platform: session.platform, platformUserId: session.userId })
  if (entry === null) return { kind: "not-entered" }
  return summary.status === "drawn" ? { kind: "not-won" } : { kind: "entered", entry }
}
