import { useEffect, useState } from "react"

/** Milliseconds left, counted down from `initialMs` (what the server computed) since the first render; never below 0. */
export function useRemainingMs(initialMs: number): number {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, initialMs - (now - startedAt))
}

export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
