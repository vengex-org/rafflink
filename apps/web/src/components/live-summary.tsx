import type { ReactNode } from "react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { statusLabel, viaLabel } from "../lib/messages.ts"

/** What the live page and the overlay both show: counts, last names and winners. `winnerActions` adds buttons per winner. */
export function LiveSummary({
  snapshot,
  winnerActions,
}: {
  readonly snapshot: LiveSnapshot
  readonly winnerActions: ((winner: LiveWinner) => ReactNode) | null
}) {
  return (
    <>
      <p className="status-line">{statusLabel[snapshot.status]}</p>
      <dl className="stats">
        <div>
          <dt>Entrants</dt>
          <dd>{snapshot.entrantCount}</dd>
        </div>
        <div>
          <dt>Tickets</dt>
          <dd>{snapshot.ticketTotal}</dd>
        </div>
        <div>
          <dt>Entries per second</dt>
          <dd>{snapshot.entriesPerSecond.toFixed(1)}</dd>
        </div>
      </dl>
      <section aria-labelledby="last-names">
        <h2 id="last-names">Latest entrants</h2>
        {snapshot.lastNames.length === 0 ? (
          <p>No entries yet.</p>
        ) : (
          <ul className="names">
            {snapshot.lastNames.map((name, index) => (
              <li key={`${index}-${name}`}>{name}</li>
            ))}
          </ul>
        )}
      </section>
      {snapshot.winners.length === 0 ? null : (
        <section aria-labelledby="winners">
          <h2 id="winners">Winners</h2>
          <ul className="winners">
            {snapshot.winners.map((winner) => (
              <li key={winner.n}>
                <span className="winner-name">
                  {winner.n + 1}. {winner.displayName ?? "(entry removed)"}
                </span>
                <span className="winner-claim">{claimLabel(winner)}</span>
                {winnerActions?.(winner)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function claimLabel(winner: LiveWinner): string {
  switch (winner.claim.state) {
    case "claimed":
      return viaLabel[winner.claim.via]
    case "waiting":
      return "Waiting to claim"
    case "expired":
      return "Claim time ran out"
    case "rerolled":
      return "Rerolled"
  }
}
