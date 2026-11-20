import { Hono, type Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Giveaway } from "../accounts/account-store.ts"
import type { Instant } from "../ports.ts"
import type { ClaimOutcome, WinnerClaim, WinnerPick } from "../room/giveaway-room.ts"
import type { PollOutcome } from "../queue/token-queue.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"
import type { AppDeps } from "./deps.ts"
import type { PublicGiveaway } from "./json.ts"
import { readViewerSession } from "./session.ts"

/** Where a signed-in viewer stands in a drawn giveaway. */
interface ViewerWin {
  readonly n: number
  readonly claimUntil: Instant
  readonly claim: WinnerClaim
}

export function giveawayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get("/api/g/:code", async (c) => {
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const summary = await deps.rooms.get(giveaway.id).summary()
    const body: PublicGiveaway & { readonly win: ViewerWin | null } = {
      code: giveaway.code,
      title: giveaway.title,
      prize: giveaway.prize,
      rules: giveaway.rules,
      status: summary.status,
      closesAt: summary.closesAt,
      claimSeconds: giveaway.claimSeconds,
      entrantCount: summary.entrantCount,
      win: summary.status === "drawn" ? await viewerWin(c, deps, giveaway) : null,
    }
    return c.json(body)
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
    const pick = await pickOf(deps, giveaway, session.userId)
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

async function pickOf(
  deps: AppDeps,
  giveaway: Giveaway,
  userId: string,
): Promise<WinnerPick | undefined> {
  const picks = await deps.rooms.get(giveaway.id).picks()
  return picks.find((pick) => pick.platform === giveaway.platform && pick.platformUserId === userId)
}

async function viewerWin(c: Context, deps: AppDeps, giveaway: Giveaway): Promise<ViewerWin | null> {
  const session = await readViewerSession(c, deps)
  if (session === null) return null
  const pick = await pickOf(deps, giveaway, session.userId)
  return pick === undefined ? null : { n: pick.n, claimUntil: pick.claimUntil, claim: pick.claim }
}
