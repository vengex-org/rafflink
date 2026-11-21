import type { LiveWinner } from "@rafflink/core/room/giveaway-room"

/** The picks a reroll did not replace, in draw order; "Winner N of M" counts these on every screen. */
export function standingWinners(winners: readonly LiveWinner[]): readonly LiveWinner[] {
  return winners.filter((winner) => winner.claim.state !== "rerolled")
}
