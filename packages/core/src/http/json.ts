import type { Context } from "hono"
import type { Giveaway } from "../accounts/account-store.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import type { Instant } from "../ports.ts"
import type { RoomStatus } from "../room/rows.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"

/** What the giveaway page needs; the overlay token and the streamer's ids stay out. */
export interface PublicGiveaway {
  readonly code: string
  readonly title: string
  readonly prize: string
  readonly rules: GiveawayRules
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly claimSeconds: number
  readonly entrantCount: number
}

/** The streamer's own view of a giveaway, with the overlay token. */
export interface DashboardGiveaway {
  readonly id: string
  readonly code: string
  readonly title: string
  readonly prize: string
  readonly rules: GiveawayRules
  readonly status: RoomStatus
  readonly closesAt: Instant | null
  readonly claimSeconds: number
  readonly overlayToken: string
  readonly createdAt: Instant
}

export function dashboardGiveaway(giveaway: Giveaway): DashboardGiveaway {
  return {
    id: giveaway.id,
    code: giveaway.code,
    title: giveaway.title,
    prize: giveaway.prize,
    rules: giveaway.rules,
    status: giveaway.status,
    closesAt: giveaway.closesAt,
    claimSeconds: giveaway.claimSeconds,
    overlayToken: giveaway.overlayToken,
    createdAt: giveaway.createdAt,
  }
}

/** The query string the sign-in callback redirects the viewer's page with. */
export function outcomeQuery(outcome: CallbackOutcome): URLSearchParams {
  const query = new URLSearchParams({ entry: outcome.kind })
  switch (outcome.kind) {
    case "pending":
      query.set("ticket", outcome.ticket)
      break
    case "not-eligible":
      query.set("reason", outcome.reason)
      break
    case "entered":
    case "already-in":
    case "closed":
    case "dropped":
    case "try-again":
    case "invalid-state":
      break
  }
  return query
}

/** Body of a request, or undefined when it is not JSON. */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
