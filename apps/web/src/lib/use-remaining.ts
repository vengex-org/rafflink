import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

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

const nowSecond = () => Math.floor(Date.now() / 1000)

/** Milliseconds until the instant `at`, to the second and never below 0; 0 while `at` is null. */
export function useMsUntil(at: number | null): number {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (at === null) return () => {}
      const timer = setInterval(onTick, 1000)
      return () => clearInterval(timer)
    },
    [at],
  )
  const second = useSyncExternalStore(subscribe, nowSecond)
  return at === null ? 0 : Math.max(0, at - second * 1000)
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
