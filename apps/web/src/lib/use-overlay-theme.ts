import { useCallback, useEffect, useRef, useState } from "react"
import {
  defaultOverlayTheme,
  parseOverlayTheme,
  type OverlayTheme,
} from "@rafflink/core/domain/overlay-theme"
import { errorClass } from "@rafflink/core/lib/error-class"
import { getOverlayTheme } from "../api/client.ts"
import type { Json } from "../api/decode.ts"

/** The overlay's theme and the hooks that keep it current; `takePush` and `reload` keep their identity. */
export interface OverlayThemeState {
  /** Null until the first answer; the default when that fails. A later failure keeps the theme shown. */
  readonly theme: OverlayTheme | null
  /** For `useLive`: takes a theme push of the overlay socket (`{ theme }`), and nothing else. */
  readonly takePush: (message: Json) => boolean
  /** Reads the theme again: a push sent while the socket was down never arrived. */
  readonly reload: () => void
}

/** Reads the theme of a giveaway's overlay when the overlay starts; after that a save reaches it as a socket push. */
export function useOverlayTheme(id: string, token: string): OverlayThemeState {
  const [theme, setTheme] = useState<OverlayTheme | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let current = true
    getOverlayTheme(id, token).then(
      (loaded) => {
        if (current) setTheme(loaded)
      },
      (error: unknown) => {
        console.warn("overlay theme unavailable", { errorClass: errorClass(error), round })
        if (current) setTheme((shown) => shown ?? defaultOverlayTheme)
      },
    )
    return () => {
      current = false
    }
  }, [id, token, round])
  const takePush = useCallback((message: Json) => {
    if (!Object.hasOwn(message, "theme")) return false
    const pushed = parseOverlayTheme(message.theme)
    if (pushed.ok) setTheme(pushed.value)
    else console.error("overlay theme push ignored", { field: pushed.issue.field })
    return true
  }, [])
  const reload = useCallback(() => setRound((value) => value + 1), [])
  return { theme, takePush, reload }
}

/** Calls `reload` each time the socket connects again after it was connected once; the first connect needs no reload. */
export function useReloadOnReconnect(connected: boolean, reload: () => void): void {
  const connectedBefore = useRef(false)
  useEffect(() => {
    if (!connected) return
    if (connectedBefore.current) reload()
    connectedBefore.current = true
  }, [connected, reload])
}
