import { errorClass } from "@rafflink/core/lib/error-class"
import type { ViewerPush } from "@rafflink/core/room/giveaway-room"
import { useEffect, useState } from "react"
import { ApiShapeError, record } from "../api/decode.ts"
import { parseViewerPush, viewerSocketPath } from "../api/client.ts"
import { reconnectDelayMs, socketUrl } from "./use-live.ts"

/**
 * Delay before reconnect number `attempt`: the backoff of the live page, scaled by 0.5 to 1 so the
 * viewers of one giveaway do not all come back in the same moment after a Durable Object restart.
 * `random` is a number from 0 up to but not including 1.
 */
export function jitteredReconnectDelayMs(attempt: number, random: number): number {
  return reconnectDelayMs(attempt) * (0.5 + 0.5 * random)
}

/**
 * The latest draw and claim state the server pushed while `enabled`; null before the first message.
 * The page only listens: it sends nothing, and it stops for good once the push says the giveaway is finished.
 */
export function useViewerPush(code: string, enabled: boolean): ViewerPush | null {
  const [push, setPush] = useState<ViewerPush | null>(null)

  useEffect(() => {
    if (!enabled) return
    let current = true
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = (attempt: number) => {
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
        const failures = healthy ? 0 : attempt
        timer = setTimeout(
          () => connect(failures + 1),
          jitteredReconnectDelayMs(failures, Math.random()),
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
