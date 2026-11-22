import { useEffect, useState } from "react"
import { defaultOverlayTheme, type OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import { errorClass } from "@rafflink/core/lib/error-class"
import { getOverlayTheme } from "../api/client.ts"

// How often the overlay asks for its theme, so a style the streamer saves reaches OBS without a reload;
// a starting guess: one small request per open overlay, and a change shows within half a minute.
const themeRefreshMs = 30_000

/**
 * The theme of a giveaway's overlay: null until the first answer, the default when that fails, and asked
 * for again every {@link themeRefreshMs}. A later failure keeps the theme the overlay already shows.
 */
export function useOverlayTheme(id: string, token: string): OverlayTheme | null {
  const [theme, setTheme] = useState<OverlayTheme | null>(null)
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async () => {
      try {
        const next = await getOverlayTheme(id, token)
        if (current) setTheme(next)
      } catch (error) {
        console.warn("overlay theme unavailable", { errorClass: errorClass(error) })
        if (current) setTheme((shown) => shown ?? defaultOverlayTheme)
      }
      if (current) timer = setTimeout(() => void load(), themeRefreshMs)
    }
    void load()
    return () => {
      current = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [id, token])
  return theme
}
