import { useEffect, useState } from "react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { ApiShapeError, record } from "../api/decode.ts"
import { getLive, parseLiveSnapshot } from "../api/client.ts"
import { errorClass } from "./use-load.ts"

export type LiveState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly snapshot: LiveSnapshot; readonly connected: boolean }
  | { readonly state: "unauthorized" | "not-found" | "failed" }

// Start and ceiling of the reconnect delay; starting guesses, a streamer's page may stay open for hours.
const reconnectBaseMs = 1000
const reconnectCapMs = 30_000

/** Delay before reconnect number `attempt` (0 is the first): doubles each time, capped. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(reconnectCapMs, reconnectBaseMs * 2 ** attempt)
}

/** The first snapshot by GET, then every push of the WebSocket on the same path; reconnects with backoff. */
export function useLive(path: string): LiveState {
  const [live, setLive] = useState<LiveState>({ state: "loading" })

  useEffect(() => {
    let current = true
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = (attempt: number) => {
      const next = new WebSocket(socketUrl(path))
      socket = next
      let healthy = false
      next.addEventListener("message", (event) => {
        try {
          const snapshot = parseLiveSnapshot(record(JSON.parse(String(event.data)), "live"))
          healthy = true
          setLive({ state: "ready", snapshot, connected: true })
        } catch (error) {
          if (!(error instanceof ApiShapeError || error instanceof SyntaxError)) throw error
          console.error("live message ignored", { errorClass: errorClass(error) })
        }
      })
      next.addEventListener("close", () => {
        if (!current) return
        setLive((previous) =>
          previous.state === "ready" ? { ...previous, connected: false } : previous,
        )
        const failures = healthy ? 0 : attempt
        timer = setTimeout(() => connect(failures + 1), reconnectDelayMs(failures))
      })
    }

    getLive(path).then(
      (first) => {
        if (!current) return
        if (typeof first === "string") {
          setLive({ state: first })
          return
        }
        setLive({ state: "ready", snapshot: first, connected: false })
        connect(0)
      },
      (error: unknown) => {
        console.error("live load failed", { errorClass: errorClass(error) })
        if (current) setLive({ state: "failed" })
      },
    )

    return () => {
      current = false
      if (timer !== null) clearTimeout(timer)
      socket?.close()
    }
  }, [path])

  return live
}

function socketUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.href
}
