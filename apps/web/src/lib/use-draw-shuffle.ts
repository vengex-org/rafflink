import { useEffect, useState } from "react"
import type { OverlaySnapshot } from "@rafflink/core/room/giveaway-room"

/** How long the shuffle shows at least, so a draw that comes back at once still reads as a draw. */
export const shuffleMinMs = 1500

/** Names to flash while the shuffle runs: the newest sample the room sent, kept for the next pick when the room sends none. */
export interface DrawShuffle {
  readonly shuffling: boolean
  readonly names: readonly string[]
}

/**
 * Whether the winner slot shuffles names instead of showing the winners. It starts when the room is asked
 * to draw, or when a pick appears that no shuffle announced, and ends once the pick exists and the shuffle
 * has run `shuffleMinMs`. A page that loads on an already drawn giveaway does not shuffle.
 */
export function useDrawShuffle(snapshot: OverlaySnapshot): DrawShuffle {
  const pending = snapshot.status === "closed" && snapshot.drawRequested
  const picks = snapshot.winners.length
  const [seenPicks, setSeenPicks] = useState(picks)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [names, setNames] = useState(snapshot.shuffleNames)
  if (snapshot.shuffleNames.length > 0 && snapshot.shuffleNames !== names) {
    setNames(snapshot.shuffleNames)
  }
  // A pick that no shuffle announced counts as shuffling from its first render, so it never shows for a frame before the effect starts the clock.
  const awaitingStart = pending || picks > seenPicks
  // The clock starts in a timer, not in the render or the effect itself; until it fires `awaitingStart` already holds the shuffle.
  useEffect(() => {
    const timer = setTimeout(() => {
      const at = Date.now()
      if (awaitingStart) setStartedAt((started) => started ?? at)
      setSeenPicks(picks)
    }, 0)
    return () => clearTimeout(timer)
  }, [awaitingStart, picks])
  useEffect(() => {
    if (startedAt === null || pending) return
    const timer = setTimeout(
      () => setStartedAt(null),
      Math.max(0, startedAt + shuffleMinMs - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [startedAt, pending])
  return { shuffling: startedAt !== null || awaitingStart, names }
}
