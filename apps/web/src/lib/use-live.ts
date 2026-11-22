import { useEffect, useState } from "react"
import type { EntrantsDelta } from "@rafflink/core/room/giveaway-room"
import { ApiShapeError, record, type Json } from "../api/decode.ts"
import { getLive, parseLivePush } from "../api/client.ts"
import { errorClass } from "@rafflink/core/lib/error-class"

export type LiveState<Snapshot> =
  | { readonly state: "loading" }
  | {
      readonly state: "ready"
      readonly snapshot: Snapshot
      readonly connected: boolean
      /** The entrants the last push added; null for a snapshot, which carries none. */
      readonly entrantsAfter: EntrantsDelta | null
      /** Known from the first answer of the streamer's own route; the overlay route has none. */
      readonly overlayToken: string | null
      /** The deployment's support page, known like the overlay token; null when unset. */
      readonly donateUrl: string | null
    }
  | { readonly state: "unauthorized" | "not-found" | "failed" }

// Start and ceiling of the reconnect delay; starting guesses, a streamer's page may stay open for hours.
const reconnectBaseMs = 1000
const reconnectCapMs = 30_000

/** Delay before reconnect number `attempt` (0 is the first): doubles each time, capped. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(reconnectCapMs, reconnectBaseMs * 2 ** attempt)
}

/**
 * The first snapshot by GET, then every push of the WebSocket on the same path; reconnects with backoff.
 * `parseSnapshot` is the decoder of the caller's audience and must keep its identity across renders, like
 * `takeOther`, which sees each message first and returns true for one that is not a snapshot and that it handled.
 */
export function useLive<Snapshot>(
  path: string,
  parseSnapshot: (source: Json) => Snapshot,
  takeOther: (message: Json) => boolean = takeNone,
): LiveState<Snapshot> {
  const [live, setLive] = useState<LiveState<Snapshot>>({ state: "loading" })

  useEffect(() => {
    let current = true
    let socket: WebSocket | null = null
    let overlayToken: string | null = null
    let donateUrl: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = (attempt: number) => {
      const next = new WebSocket(socketUrl(path))
      socket = next
      let healthy = false
      next.addEventListener("message", (event) => {
        try {
          const message = record(JSON.parse(String(event.data)), "live")
          if (takeOther(message)) return
          const { snapshot, entrantsAfter } = parseLivePush(message, parseSnapshot)
          healthy = true
          setLive({
            state: "ready",
            snapshot,
            connected: true,
            entrantsAfter,
            overlayToken,
            donateUrl,
          })
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

    getLive(path, parseSnapshot).then(
      (first) => {
        if (!current) return
        if (typeof first === "string") {
          setLive({ state: first })
          return
        }
        overlayToken = first.overlayToken
        donateUrl = first.donateUrl
        setLive({
          state: "ready",
          snapshot: first.snapshot,
          connected: false,
          entrantsAfter: null,
          overlayToken,
          donateUrl,
        })
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
  }, [path, parseSnapshot, takeOther])

  return live
}

// Module scope keeps its identity, so a caller without other messages does not reopen the socket on every render.
function takeNone(): boolean {
  return false
}

export function socketUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.href
}
