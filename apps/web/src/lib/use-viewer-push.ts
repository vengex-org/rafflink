import { errorClass } from "@rafflink/core/lib/error-class"
import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import { useEffect, useState } from "react"
import { ApiShapeError, record } from "../api/decode.ts"
import { parseViewerPush, viewerSocketPath } from "../api/client.ts"
import { reconnectDelayMs, socketUrl } from "./use-live.ts"

/**
 * Delay before reconnect number `attempt`: a random point from 0 up to the backoff of the live page,
 * so the viewers of one giveaway spread out instead of coming back together after a Durable Object
 * restart. `random` is a number from 0 up to but not including 1.
 */
export function jitteredReconnectDelayMs(attempt: number, random: number): number {
  return reconnectDelayMs(attempt) * random
}

/**
 * Connections in a row that closed before the server sent one valid message. With
 * {@link minViewerSocketGiveUpMs} it decides when the page stops trying: a refused socket (wrong origin,
 * deleted giveaway, server error) never recovers, and every attempt is a billed request. A starting guess.
 */
export const maxViewerSocketFailures = 4

/**
 * Least time from the first failure of a streak before the page gives up, so a Wi-Fi to LTE switch,
 * which fails connections for a while, does not end the push. The backoff between attempts is capped at
 * 30 s, so the page makes about three attempts within it. A starting guess.
 */
export const minViewerSocketGiveUpMs = 60_000

/**
 * The latest draw and claim state the server pushed while `enabled`; null before the first message.
 * The page only listens: it sends nothing, and it stops for good once the push says the giveaway is
 * finished or has given up after {@link maxViewerSocketFailures} failures in a row over at least
 * {@link minViewerSocketGiveUpMs}. A given-up page tries once more when the browser comes back online or
 * the tab becomes visible.
 */
export function useViewerPush(code: string, enabled: boolean): ViewerPush | null {
  const [push, setPush] = useState<ViewerPush | null>(null)

  useEffect(() => {
    if (!enabled) return
    let current = true
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    let givenUp = false

    // `failures` counts the connections in a row that closed before a valid message; `streakStart` is
    // the time of the first of them.
    const connect = (failures: number, streakStart: number | null) => {
      givenUp = false
      const next = new WebSocket(socketUrl(viewerSocketPath(code)))
      socket = next
      let healthy = false
      let finished = false
      next.addEventListener("message", (event) => {
        try {
          const received = parseViewerPush(record(JSON.parse(String(event.data)), "push"))
          healthy = true
          finished = received.finished
          setPush(received)
          if (finished) next.close()
        } catch (error) {
          if (!(error instanceof ApiShapeError || error instanceof SyntaxError)) throw error
          console.error("viewer push ignored", { errorClass: errorClass(error) })
        }
      })
      next.addEventListener("close", () => {
        if (!current || finished) return
        const failed = healthy ? 0 : failures + 1
        const started = healthy ? null : (streakStart ?? Date.now())
        if (
          started !== null
          && failed >= maxViewerSocketFailures
          && Date.now() - started >= minViewerSocketGiveUpMs
        ) {
          console.warn("viewer socket given up", { failures: failed })
          givenUp = true
          return
        }
        timer = setTimeout(
          () => connect(failed, started),
          jitteredReconnectDelayMs(Math.max(0, failed - 1), Math.random()),
        )
      })
    }

    const retryAfterGivingUp = () => {
      if (givenUp && current && document.visibilityState === "visible") connect(0, null)
    }
    window.addEventListener("online", retryAfterGivingUp)
    document.addEventListener("visibilitychange", retryAfterGivingUp)

    connect(0, null)
    return () => {
      current = false
      window.removeEventListener("online", retryAfterGivingUp)
      document.removeEventListener("visibilitychange", retryAfterGivingUp)
      if (timer !== null) clearTimeout(timer)
      socket?.close()
    }
  }, [code, enabled])

  return push
}
