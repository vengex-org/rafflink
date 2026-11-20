import { useState, type ReactNode } from "react"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import { viaLabel } from "../lib/messages.ts"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"

/** A number with what it counts, so no figure stands alone. */
export function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function EntrantNames({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) return <p className="muted">Nobody has entered yet.</p>
  return (
    <ul className="names">
      {names.map((name, index) => (
        <li key={`${index}-${name}`}>{name}</li>
      ))}
    </ul>
  )
}

/** Every winner with how their claim stands; `actions` adds buttons per winner. */
export function WinnerList({
  winners,
  actions,
}: {
  readonly winners: readonly LiveWinner[]
  readonly actions: ((winner: LiveWinner) => ReactNode) | null
}) {
  return (
    <ul className="winners">
      {winners.map((winner) => (
        <li key={winner.n} data-claim={winner.claim.state}>
          <span className="winner-name">
            {winner.n + 1}. {winner.displayName ?? "(entry removed)"}
          </span>
          <span className="winner-claim">{claimLabel(winner)}</span>
          {winner.claim.state === "waiting" ? <ClaimClock until={winner.claimUntil} /> : null}
          {actions?.(winner)}
        </li>
      ))}
    </ul>
  )
}

function ClaimClock({ until }: { readonly until: number }) {
  const [initial] = useState(() => Math.max(0, until - Date.now()))
  const remaining = useRemainingMs(initial)
  return (
    <span className="claim-clock">
      <span role="timer">{formatClock(remaining)}</span> min left to claim
    </span>
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
      return "Replaced by another winner"
  }
}
