import { createContext, useContext, useEffect, useState } from "react"

/** The time the countdowns read. */
export interface Clock {
  readonly now: () => number
  /** False while the time stands still: countdowns stop ticking and show what they had left. */
  readonly running: boolean
}

// `Date.now` is looked up per call, so the tests' fake timers reach it.
const clock = createContext<Clock>({ now: () => Date.now(), running: true })

/** The home page stage supplies its own, which stops while the stage is paused. */
export const ClockProvider = clock.Provider

export const useClock = () => useContext(clock)

/** Milliseconds left, counted down from `initialMs` (what the server computed) since the first render; never below 0. */
export function useRemainingMs(initialMs: number): number {
  const { now: readNow, running } = useClock()
  const [startedAt] = useState(readNow)
  const [now, setNow] = useState(startedAt)
  const remaining = Math.max(0, initialMs - (now - startedAt))
  const over = remaining === 0
  useEffect(() => {
    if (over || !running) return
    const timer = setInterval(() => setNow(readNow()), 1000)
    return () => clearInterval(timer)
  }, [over, running, readNow])
  return remaining
}

export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** A time left in the words people say it: "2 h 5 min", "12 min", "40 s". */
export function formatLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
