import { useEffect, useEffectEvent, useState } from "react"
import { useSearchParams } from "react-router"
import { pollEntry, type EntryResult } from "../api/client.ts"
import { errorClass } from "@rafflink/core/lib/error-class"
import type { PollTiming } from "./poll-timing.ts"
import { forgetStoredGiveaway } from "./stored-giveaway.ts"

/** An entry the page stopped waiting for. */
export type EntryView = EntryResult | { readonly kind: "timed-out" }

/**
 * The outcome to show; a pending one is polled every `poll.intervalMs` until it settles or `poll.maxMs` pass.
 * The outcome comes in the page's query: a settled one is removed from the address at once, a pending one when its poll ends.
 * `onEntered` runs once when a queued entry settles as entered or already-in, because the poll answer
 * starts the viewer's session and the page then has to ask who the viewer is.
 */
export function useEntryResult(
  code: string,
  initial: EntryResult | null,
  poll: PollTiming,
  onEntered: () => void,
): EntryView | null {
  const [view, setView] = useState<EntryView | null>(initial)
  const ticket = initial?.kind === "pending" ? initial.ticket : null
  const [, setQuery] = useSearchParams()
  // The ticket in the address is spent once the poll ends, so a reload must not poll it again.
  const forgetEntryInUrl = useEffectEvent(() =>
    setQuery(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const name of ["entry", "ticket", "reason"]) next.delete(name)
        return next
      },
      { replace: true },
    ),
  )

  useEffect(() => {
    if (initial !== null && initial.kind !== "pending") forgetEntryInUrl()
  }, [initial])

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
          forgetEntryInUrl()
          return
        }
        try {
          const result = await pollEntry(code, ticket)
          if (!current) return
          if (result.kind !== "pending") {
            forgetStoredGiveaway(code)
            setView(result)
            forgetEntryInUrl()
            if (result.kind === "entered" || result.kind === "already-in") onEntered()
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
  }, [code, ticket, poll.intervalMs, poll.maxMs, onEntered])

  return view
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
