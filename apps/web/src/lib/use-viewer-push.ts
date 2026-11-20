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
 * Connections in a row that closed without ever opening, after which the page stops trying. A refused
 * socket (wrong origin, deleted giveaway, server error) never recovers, and every attempt is a billed
 * request; a starting guess, about seven seconds of backoff.
 */
export const maxViewerSocketFailures = 4

/**
 * The latest draw and claim state the server pushed while `enabled`; null before the first message.
 * The page only listens: it sends nothing, and it stops for good once the push says the giveaway is
 * finished or {@link maxViewerSocketFailures} connections in a row never opened.
 */
export function useViewerPush(code: string, enabled: boolean): ViewerPush | null {
  const [push, setPush] = useState<ViewerPush | null>(null)

  useEffect(() => {
    if (!enabled) return
    let current = true
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    // `failures` counts the connections in a row that closed without opening.
    const connect = (failures: number) => {
      const next = new WebSocket(socketUrl(viewerSocketPath(code)))
      socket = next
      let opened = false
      let finished = false
      next.addEventListener("open", () => {
        opened = true
      })
      next.addEventListener("message", (event) => {
        try {
          const received = parseViewerPush(record(JSON.parse(String(event.data)), "push"))
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
        const failed = opened ? 0 : failures + 1
        if (failed >= maxViewerSocketFailures) {
          console.warn("viewer socket given up", { failures: failed })
          return
        }
        timer = setTimeout(
          () => connect(failed),
          jitteredReconnectDelayMs(Math.max(0, failed - 1), Math.random()),
        )
      })
    }

    connect(0)
    return () => {
      current = false
      if (timer !== null) clearTimeout(timer)
      socket?.close()
    }
  }, [code, enabled])

  return push
}
