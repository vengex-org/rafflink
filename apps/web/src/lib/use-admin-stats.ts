import { errorClass } from "@rafflink/core/lib/error-class"
import { reportError } from "./error-reporting.ts"
import { useEffect, useRef, useState } from "react"
import { getAdminStats, type AdminStats } from "../api/client.ts"

/** How often the admin page asks for fresh statistics while it is on screen; the server reuses an answer for a few seconds, so two admins cost one read. */
export const adminStatsPollMs = 10_000

export type AdminStatsLoad =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly stats: AdminStats }
  /** The last request failed; `stats` is the last answer, if any. */
  | { readonly state: "failed"; readonly stats: AdminStats | null }

/**
 * The admin statistics, asked again every {@link adminStatsPollMs} while the tab is visible. A hidden tab
 * asks nothing, and showing it again asks at once. `refreshNow` asks at once past the server's copy.
 */
export function useAdminStats(): { readonly load: AdminStatsLoad; refreshNow(): void } {
  const [load, setLoad] = useState<AdminStatsLoad>({ state: "loading" })
  const [forced, setForced] = useState(0)
  const last = useRef<AdminStats | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setInterval> | null = null
    let inFlight = false
    let fresh = forced > 0

    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      const skipCopy = fresh
      fresh = false
      try {
        last.current = await getAdminStats(skipCopy)
        if (mounted) setLoad({ state: "ready", stats: last.current })
      } catch (error) {
        console.error("admin stats failed", { errorClass: errorClass(error) })
        reportError(error)
        if (mounted) setLoad({ state: "failed", stats: last.current })
      } finally {
        inFlight = false
      }
    }
    const start = () => {
      if (timer !== null) return
      void refresh()
      timer = setInterval(() => void refresh(), adminStatsPollMs)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop())

    document.addEventListener("visibilitychange", onVisibility)
    onVisibility()
    return () => {
      mounted = false
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [forced])

  return { load, refreshNow: () => setForced((count) => count + 1) }
}
