import { useEffect, useState } from "react"
import { pollEntry, type EntryResult } from "../api/client.ts"
import { errorClass } from "./use-load.ts"
import type { PollTiming } from "./poll-timing.ts"

/** An entry the page stopped waiting for. */
export type EntryView = EntryResult | { readonly kind: "timed-out" }

/** The outcome to show; a pending one is polled every `poll.intervalMs` until it settles or `poll.maxMs` pass. */
export function useEntryResult(
  code: string,
  initial: EntryResult | null,
  poll: PollTiming,
): EntryView | null {
  const [view, setView] = useState<EntryView | null>(initial)
  const ticket = initial?.kind === "pending" ? initial.ticket : null

  useEffect(() => {
    if (ticket === null) return
    let current = true
    const deadline = Date.now() + poll.maxMs
    void (async () => {
      for (;;) {
        await sleep(poll.intervalMs)
        if (!current) return
        if (Date.now() >= deadline) {
          setView({ kind: "timed-out" })
          return
        }
        try {
          const result = await pollEntry(code, ticket)
          if (!current) return
          if (result.kind !== "pending") {
            setView(result)
            return
          }
        } catch (error) {
          console.error("entry poll failed", { errorClass: errorClass(error) })
        }
      }
    })()
    return () => {
      current = false
    }
  }, [code, ticket, poll.intervalMs, poll.maxMs])

  return view
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
