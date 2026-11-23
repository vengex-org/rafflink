import { presenceSocketPath, type PresenceKind } from "@rafflink/core/presence/site-presence"
import { useEffect } from "react"
import { parseGiveawayCode } from "./giveaway-code.ts"
import { socketUrl } from "./use-live.ts"
import {
  jitteredReconnectDelayMs,
  maxViewerSocketFailures,
  minViewerSocketGiveUpMs,
} from "./use-viewer-push.ts"

/**
 * The kind of page the admin page counts a path under, or null for the stream's pages: the OBS overlay, the
 * streamer's live page and a moderator's live page, which hold sockets of their own and are no visitors.
 * A first segment is read the way {@link parseGiveawayCode} and the routes of app.tsx read it.
 */
export function presenceKindOf(pathname: string): PresenceKind | null {
  const [first = "", second] = pathname.split("/").filter((segment) => segment !== "")
  const code = parseGiveawayCode(first)
  if (code === first) return "giveaway"
  switch (first.toLowerCase()) {
    case "":
      return "home"
    case "privacy":
    case "terms":
      return "legal"
    case "dashboard":
    case "admin":
      return "dashboard"
    case "g":
      return "giveaway"
    case "overlay":
    case "live":
      return null
    case "mod":
      return second === undefined ? "other" : null
    default:
      return code === null ? "other" : "giveaway"
  }
}

/**
 * A socket that stayed open this long ends a failure streak when it closes: a socket the server accepts and
 * ends at once must not reconnect in a tight loop. A starting guess.
 */
export const presenceHealthyMs = 30_000

/**
 * Delay before the next try after `failures` closes in a row over `streakMs`, or null when the page stops
 * trying; the same backoff and give-up as the viewer push, since every try is a billed request.
 */
export function presenceRetryDelayMs(
  failures: number,
  streakMs: number,
  random: number,
): number | null {
  if (failures >= maxViewerSocketFailures && streakMs >= minViewerSocketGiveUpMs) return null
  return jitteredReconnectDelayMs(failures - 1, random)
}

/**
 * Holds one presence socket open while the page of `kind` is shown, so the admin page counts it; null opens
 * none. The page sends nothing and the server sends nothing. The socket closes on `pagehide` and opens again
 * when the browser shows the page from its back-forward cache.
 */
export function useSitePresence(kind: PresenceKind | null): void {
  useEffect(() => {
    if (kind === null) return
    const url = socketUrl(`${presenceSocketPath}?kind=${kind}`)
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let streakStart = 0

    const connect = () => {
      const next = new WebSocket(url)
      socket = next
      let openedAt: number | null = null
      next.addEventListener("open", () => {
        openedAt = Date.now()
      })
      next.addEventListener("close", () => {
        if (socket !== next) return
        socket = null
        const now = Date.now()
        if (openedAt !== null && now - openedAt >= presenceHealthyMs) failures = 0
        if (failures === 0) streakStart = now
        failures += 1
        const delayMs = presenceRetryDelayMs(failures, now - streakStart, Math.random())
        if (delayMs === null) {
          console.warn("presence socket given up", { failures })
          return
        }
        timer = setTimeout(connect, delayMs)
      })
    }

    // `socket` is cleared before the close, so its close event schedules no reconnect.
    const stop = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      const open = socket
      socket = null
      open?.close()
    }
    const resume = (event: PageTransitionEvent) => {
      if (!event.persisted || socket !== null) return
      failures = 0
      connect()
    }
    window.addEventListener("pagehide", stop)
    window.addEventListener("pageshow", resume)

    connect()
    return () => {
      window.removeEventListener("pagehide", stop)
      window.removeEventListener("pageshow", resume)
      stop()
    }
  }, [kind])
}
